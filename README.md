# TracPoll — Decentralized Real-Time Polling on Intercom

> A fork of [Trac-Systems/intercom](https://github.com/Trac-Systems/intercom) that adds **TracPoll**: a peer-to-peer polling and voting app where agents create polls, peers vote over Intercom sidechannels, and final tallies are committed to the replicated contract state.

---

## 💰 Trac Reward Address

```
trac1qp2negnqp5f0e6ww9mya4tmsdgg4f72nhqalcmpqtjgyn88jgvgqyyqhht
```

---

## What is TracPoll?

TracPoll turns Intercom's P2P sidechannels into a **live voting room** and its replicated contract into a **tamper-resistant tally ledger**.

- **Create a poll** with up to 8 options — instantly broadcast to all connected peers via sidechannel.
- **Vote in real time** — your vote is relayed over the P2P mesh, deduplicated by peer key.
- **Tally committed on-chain** — when the poll creator closes a poll, the final results are written to the Intercom contract/replicated state (Autobase/Hyperbee), making them permanent and auditable.
- **Agent-friendly** — fully controllable via SC-Bridge (WebSocket JSON API), no TTY needed.

### Key differentiators vs existing forks
| Feature | TracPoll | AlphaSwarm | Idea Inbox | TracStamp |
|---|---|---|---|---|
| Real-time voting | ✅ | ❌ | ❌ | ❌ |
| Permanent tally on contract | ✅ | ❌ | ✅ | ✅ |
| Multi-peer deduplication | ✅ | ❌ | ❌ | ❌ |
| Agent SC-Bridge control | ✅ | ✅ | ❌ | ❌ |

---

## Quick Start

```bash
# Install Pear runtime (required)
npm i -g pear

# Clone this repo
git clone https://github.com/cryptobo1/intercom
cd intercom
npm install

# Run the admin/creator peer (creates the subnet)
pear run . --peer-store-name admin --msb-store-name msb-admin \
  --subnet-channel tracpoll-main \
  --sidechannels tracpoll-votes \
  --sc-bridge-port 8080

# Run a voter peer (replace <ADMIN_KEY> with the key printed by the admin)
pear run . --peer-store-name voter1 --msb-store-name msb-v1 \
  --subnet-channel tracpoll-main \
  --subnet-bootstrap <ADMIN_KEY> \
  --sidechannels tracpoll-votes \
  --sc-bridge-port 8081
```

---

## Using TracPoll via SC-Bridge

All commands are sent as JSON over WebSocket to `ws://localhost:<port>`.

### 1. Authenticate
```json
{ "cmd": "auth", "secret": "<your-bridge-secret>" }
```

### 2. Create a Poll (admin peer)
```json
{
  "cmd": "send",
  "channel": "tracpoll-votes",
  "payload": {
    "type": "poll:create",
    "id": "poll-001",
    "question": "What should we build next on Trac Network?",
    "options": ["DeFi lending", "NFT marketplace", "DAO governance", "P2P gaming"],
    "closes_at": 1740000000
  }
}
```

### 3. Vote (any peer)
```json
{
  "cmd": "send",
  "channel": "tracpoll-votes",
  "payload": {
    "type": "poll:vote",
    "poll_id": "poll-001",
    "option_index": 2
  }
}
```

### 4. Close Poll & Commit Tally (admin peer)
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
The admin peer's contract handler picks this up, tallies all votes received on the sidechannel (deduplicated by sender peer key), and writes the final result to the replicated Hyperbee state under `polls/<poll-id>/result`.

### 5. Read Results
```json
{ "cmd": "info" }
```
Results are replicated to all subnet peers automatically via Autobase.

---

## Architecture

```
  [Poll Creator Agent]
        |
        | SC-Bridge (ws)
        v
  [Admin Intercom Peer]
        |
        |-- sidechannel: "tracpoll-votes" --> [Voter Peer 1]
        |                                --> [Voter Peer 2]
        |                                --> [Voter Peer N]
        |
        | on poll:close event:
        | tally votes (deduplicate by peer key)
        | write to contract (Autobase/Hyperbee)
        v
  [Replicated State: polls/<id>/result]
        |
        | auto-replicated to all subnet peers
        v
  [All Peers can read final tally]
```

---

## File Structure

```
intercom/
├── README.md            ← This file
├── SKILL.md             ← Agent instructions (updated for TracPoll)
├── index.js             ← Intercom core (upstream) + TracPoll hooks
├── features/
│   └── tracpoll.js      ← Poll create/vote/close/tally logic
├── contract/
│   └── index.js         ← Contract handlers (extended for poll results)
├── package.json
└── screenshots/
    ├── create-poll.png
    ├── live-votes.png
    └── tally-result.png
```

---

## Screenshots

See `/screenshots/` folder in this repo for proof of operation:
- `create-poll.png` — Poll creation via SC-Bridge
- `live-votes.png` — Live vote feed on sidechannel
- `tally-result.png` — Final tally committed to contract state

---

## Based On

- [Intercom](https://github.com/Trac-Systems/intercom) by Trac Systems (MIT)
- Pear runtime / Hyperswarm / Autobase / Hyperbee
- 
