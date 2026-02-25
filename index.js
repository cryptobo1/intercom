'use strict'

/**
 * TracPoll — Decentralized Real-Time Polling on Intercom
 *
 * Hooks into Intercom's sidechannel message handler to implement:
 *   - poll:create  → store poll definition
 *   - poll:vote    → record vote, deduplicated by sender peer key
 *   - poll:close   → tally votes and commit result to contract (Hyperbee)
 *   - poll:result  → (emitted) broadcast final tally to peers
 *
 * Usage: require this module and call tracpoll.attach(intercomPeer)
 */

class TracPoll {
  constructor () {
    // In-memory poll store: pollId -> { meta, votes: Map<peerKeyHex, optionIndex> }
    this.polls = new Map()
  }

  /**
   * Attach TracPoll to an Intercom peer instance.
   * @param {object} peer - Intercom peer with .on() for sidechannel messages
   *                        and .contractPut(key, value) for replicated state writes.
   * @param {string} channel - sidechannel name to listen on (e.g. 'tracpoll-votes')
   */
  attach (peer, channel = 'tracpoll-votes') {
    this.peer = peer
    this.channel = channel

    // Listen for incoming sidechannel messages
    peer.on('sidechannel:message', ({ channel: ch, payload, senderKey }) => {
      if (ch !== channel) return
      this._handleMessage(payload, senderKey).catch(err => {
        console.error('[TracPoll] handler error:', err)
      })
    })

    console.log(`[TracPoll] attached to sidechannel "${channel}"`)
  }

  async _handleMessage (payload, senderKey) {
    if (!payload || !payload.type) return
    const senderHex = Buffer.isBuffer(senderKey)
      ? senderKey.toString('hex')
      : String(senderKey)

    switch (payload.type) {
      case 'poll:create':
        return this._onCreate(payload, senderHex)
      case 'poll:vote':
        return this._onVote(payload, senderHex)
      case 'poll:close':
        return this._onClose(payload, senderHex)
      default:
        // Unknown message type — ignore silently
    }
  }

  _onCreate (payload, senderHex) {
    const { id, question, options, closes_at } = payload
    if (!id || !question || !Array.isArray(options) || options.length < 2) {
      console.warn('[TracPoll] poll:create — invalid payload, ignoring')
      return
    }
    if (this.polls.has(id)) {
      console.warn(`[TracPoll] poll:create — poll "${id}" already exists, ignoring`)
      return
    }

    this.polls.set(id, {
      meta: {
        question,
        options,
        closes_at: closes_at || null,
        creator: senderHex,
        created_at: Date.now()
      },
      votes: new Map(), // senderHex -> optionIndex
      closed: false
    })

    console.log(`[TracPoll] Poll created: "${question}" (id=${id}, options=${options.length})`)
  }

  _onVote (payload, senderHex) {
    const { poll_id, option_index } = payload
    const poll = this.polls.get(poll_id)

    if (!poll) {
      console.warn(`[TracPoll] poll:vote — unknown poll "${poll_id}", ignoring`)
      return
    }
    if (poll.closed) {
      console.warn(`[TracPoll] poll:vote — poll "${poll_id}" is already closed, ignoring`)
      return
    }
    if (typeof option_index !== 'number' || option_index < 0 || option_index >= poll.meta.options.length) {
      console.warn(`[TracPoll] poll:vote — invalid option_index ${option_index}, ignoring`)
      return
    }
    if (poll.votes.has(senderHex)) {
      console.warn(`[TracPoll] poll:vote — peer ${senderHex.slice(0, 8)}… already voted, ignoring duplicate`)
      return
    }

    poll.votes.set(senderHex, option_index)
    console.log(`[TracPoll] Vote recorded on "${poll_id}": option ${option_index} by ${senderHex.slice(0, 8)}…  (total votes: ${poll.votes.size})`)
  }

  async _onClose (payload, senderHex) {
    const { poll_id } = payload
    const poll = this.polls.get(poll_id)

    if (!poll) {
      console.warn(`[TracPoll] poll:close — unknown poll "${poll_id}", ignoring`)
      return
    }
    if (poll.closed) {
      console.warn(`[TracPoll] poll:close — poll "${poll_id}" already closed, ignoring`)
      return
    }

    // Compute tally
    const tallies = new Array(poll.meta.options.length).fill(0)
    for (const optIdx of poll.votes.values()) {
      tallies[optIdx]++
    }

    const result = {
      tallies,
      total_votes: poll.votes.size,
      closed_at: Date.now(),
      winner_index: tallies.indexOf(Math.max(...tallies)),
      winner_option: poll.meta.options[tallies.indexOf(Math.max(...tallies))]
    }

    poll.closed = true
    poll.result = result

    console.log(`[TracPoll] Poll "${poll_id}" closed. Result:`)
    poll.meta.options.forEach((opt, i) => {
      console.log(`  [${i}] ${opt}: ${tallies[i]} vote(s)`)
    })
    console.log(`  Winner: "${result.winner_option}" (${tallies[result.winner_index]} votes)`)

    // Commit to replicated contract state (Hyperbee via Autobase)
    if (this.peer && typeof this.peer.contractPut === 'function') {
      await this.peer.contractPut(
        `polls/${poll_id}/meta`,
        JSON.stringify({ question: poll.meta.question, options: poll.meta.options, created_at: poll.meta.created_at })
      )
      await this.peer.contractPut(
        `polls/${poll_id}/result`,
        JSON.stringify(result)
      )
      console.log(`[TracPoll] Tally for "${poll_id}" committed to replicated state.`)
    } else {
      console.warn('[TracPoll] No contractPut available — tally stored in memory only.')
    }

    // Broadcast result back to sidechannel peers
    if (this.peer && typeof this.peer.sendSidechannel === 'function') {
      await this.peer.sendSidechannel(this.channel, {
        type: 'poll:result',
        poll_id,
        question: poll.meta.question,
        options: poll.meta.options,
        result
      })
    }
  }

  /**
   * Get current state of a poll (for local inspection / SC-Bridge info).
   * @param {string} pollId
   * @returns {object|null}
   */
  getPoll (pollId) {
    const poll = this.polls.get(pollId)
    if (!poll) return null
    return {
      meta: poll.meta,
      total_votes: poll.votes.size,
      closed: poll.closed,
      result: poll.result || null
    }
  }

  /**
   * List all known poll IDs.
   * @returns {string[]}
   */
  listPolls () {
    return Array.from(this.polls.keys())
  }
}

module.exports = new TracPoll()
