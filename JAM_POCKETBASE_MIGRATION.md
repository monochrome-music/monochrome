# PocketBase Jam Feature Schema Migration

To support the Jam feature, you need to create a single new collection in your PocketBase instance.

## 1. Collection: `jam_sessions`
**Type**: Base
**System Options**:
- List/Search Rule: `@request.auth.id != ""` (Any logged-in user can search to find a session by token)
- View Rule: `@request.auth.id != ""`
- Create Rule: `@request.auth.id != ""`
- Update Rule: `@request.auth.id != ""`
- Delete Rule: `@request.auth.id != ""`

**Fields**:
1. `host` (Relation): Single relation to `DB_users`, max select 1.
2. `current_track` (Json): Stores the current track metadata.
3. `playback_state` (Text): Playing/paused state.
4. `position` (Number): Current position in seconds.
5. `queue` (Json): Stores the remaining queue tracks.
6. `participants` (Relation): Multiple relation to `DB_users`.
7. `allow_participant_queueing` (Bool): If true, participants can add to the queue. Default to false or true (we will default to true).
8. `token` (Text): A unique 20-character string used to join the session.
