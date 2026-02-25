# SKILL.md — TracPoll on Intercom

This file provides agent-oriented instructions for operating the **TracPoll** app built on Intercom.

TracPoll = Intercom + a decentralized real-time polling layer.  
Polls are created and voted on over Intercom **sidechannels**; final tallies are committed to the **replicated contract state** (Autobase/Hyperbee).

---

## Prerequisites

- **Pear runtime** (mandatory — never use plain `node`):  
  `npm i -g pear`
- Node.js ≥ 20 (used internally by Pear)
- Clone this repo and run `npm install`

---

## Running Peers

### Admin / Poll-Creator Peer

```bash
pear run . \
  --peer-store-name admin \
  --msb-store-name msb-admin \
  --subnet-channel tracpoll-main \
  --sidechannels tracpoll-votes \
  --sc-bridge-port 8080
```

On first run, the admin peer prints its **writer key** — share this with voter peers as `<ADMIN_KEY>`.

### Voter Peer

```bash
pear run . \
  --peer-store-name voter1 \
  --msb-store-name msb-v1 \
  --subnet-channel tracpoll-main \
  --subnet-bootstrap <ADMIN_KEY> \
  --sidechannels tracpoll-votes \
  --sc-bridge-port 8081
```

Multiple voter peers can run on different machines; all use the same `<ADMIN_KEY>`.

---

## SC-Bridge (WebSocket API)

Connect to `ws://localhost:<sc-bridge-port>` and send JSON commands.

### Auth (required first)
```json
{ "cmd": "auth", "secret": "<bridge-secret>" }
```

### Create a Poll
```json
{
  "cmd": "send",
  "channel": "tracpoll-votes",
  "payload": {
    "type": "poll:create",
    "id": "poll-001",
    "question": "Your question here?",
    "options": ["Option A", "Option B", "Option C"],
    "closes_at": <unix-timestamp-or-null>
  }
}
```

### Cast a Vote
```json
{
  "cmd": "send",
  "channel": "tracpoll-votes",
  "payload": {
    "type": "poll:vote",
    "poll_id": "poll-001",
    "option_index": 0
  }
}
```
Each peer key may vote once per poll. Duplicate votes from the same peer key are silently ignored.

### Close Poll + Commit Tally
```json
{
  "cmd": "send",
  "channel": "tracpoll-votes",
  "payload": {
    "type": "poll:close",
    "poll_id": "poll-001"
  }
}
```
Only the admin (subnet writer) peer should send this. On receipt, the tally is computed and written to the contract under `polls/poll-001/result`.

### Read Any Replicated State
```json
{ "cmd": "info" }
```

---

## TracPoll Message Types (sidechannel payloads)

| Type | Sender | Effect |
|---|---|---|
| `poll:create` | Admin | Broadcasts poll definition to all peers |
| `poll:vote` | Any peer | Records vote (deduplicated by peer public key) |
| `poll:close` | Admin | Triggers tally computation + contract write |
| `poll:result` | Admin (auto) | Broadcasts final tally after close |

---

## Contract State Schema

Written to Hyperbee (replicated to all subnet peers):

```
polls/<poll-id>/meta      → { question, options, created_at }
polls/<poll-id>/result    → { tallies: [n, n, n, ...], total_votes: n, closed_at: ts }
```

---

## TracPoll Feature Logic (`features/tracpoll.js`)

The TracPoll feature module hooks into Intercom's sidechannel message handler:

```js
// Pseudocode — see features/tracpoll.js for full implementation
onSidechannelMessage('tracpoll-votes', (msg, senderKey) => {
  if (msg.type === 'poll:create') storePollDefinition(msg)
  if (msg.type === 'poll:vote')   recordVote(msg.poll_id, senderKey, msg.option_index)
  if (msg.type === 'poll:close')  computeAndCommitTally(msg.poll_id)
})
```

---

## Troubleshooting

- **Peers not discovering each other**: ensure all peers use the same `--subnet-channel` and correct `--subnet-bootstrap` key.
- **Votes not deduplicating**: verify senderKey is being read from the Hyperswarm/Protomux connection object, not from the payload.
- **Tally not written to contract**: only the admin (writer) peer can commit state. Check that `poll:close` is sent from the admin peer's SC-Bridge connection.
- **DHT issues on LAN**: use `--dht-bootstrap` with the same bootstrap address on all peers.

---

## Trac Reward Address

```
trac1qp2negnqp5f0e6ww9mya4tmsdgg4f72nhqalcmpqtjgyn88jgvgqyyqhht
```
