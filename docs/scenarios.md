# Admin scenarios

Scope: every situation someone from the Apni Dukan team (or someone who isn't) can hit on the admin website, checked
against the admin API contract (backend PR "Admin roles, OTP test mode, field-visit pages", written in parallel) and
this app (`src/**`). "What the API answers" comes from the contract; the fake backend `e2e/mockApi.ts` answers the
same. App tests are Vitest (`unit:<file> "<describe>"`) and Playwright (`e2e:<spec> "<title>"`).

Verdicts: **OK-tested**, **OK-untested** (correct but no test), **GAP** (wrong or missing, with why), **N/A-v1** (a v1
limit the README states).

How to use it: every new feature or fix adds or updates rows. A row is done when both the API and the screen behave
as written and a test proves it. Reviews walk this list against the code.

## Sign-in and session

| # | Scenario | What the API answers | What the screen shows | Test | Verdict |
|---|---|---|---|---|---|
| 1 | Admin signs in with phone and code | `POST /auth/otp/send` 202; `/auth/otp/verify` 200 tokens, `user.adminRole: ADMIN` | Phone → code → dashboard | e2e:signin "an admin signs in with phone and code…" | OK-tested |
| 2 | Not a valid Indian mobile number | — (not sent) | Send code stays off | unit:PhoneStep.test "only allows sending a code…" | OK-tested |
| 3 | Wrong code | 400 WRONG_CODE with tries left | The backend's words; code box cleared | e2e:signin "an admin signs in…" | OK-tested |
| 4 | Robot check (Turnstile) when a site key is set | 400 CAPTCHA_REQUIRED / CAPTCHA_FAILED | Widget shown, Send code waits for it, fresh token after any failure (partner app's code) | — | OK-untested (e2e runs without a site key) |
| 5 | Signed in, `adminRole: NONE` (existing or brand-new account) | tokens with `adminRole: NONE` | "This is for the Apni Dukan team" on every address, Check again and Sign out; no email or name steps; no `/admin` call | e2e:signin "someone not on the team sees…"; unit:flow.test "sends someone not on the team…" | OK-tested |
| 6 | Not on the team, then added by the super admin | refresh gives `adminRole: ADMIN` | Check again lets them in | e2e:signin "someone added to the team while on the…" | OK-tested |
| 7 | New admin with no verified email or name | tokens, email missing | Email step, then name step, then the dashboard | e2e:signin "a new admin without a verified email…" | OK-tested |
| 8 | Lost phone: recovery with email | `/auth/recover/start` 202; `/recover/complete` 200 tokens or 400 WRONG_CODE | Two codes, then in; a wrong code says so | e2e:signin "recovery with email…" | OK-tested |
| 9 | Admin taken off the team; their token is older | `GET /admin/me` 404 NOT_FOUND (any `/admin` call: 404) | "This is for the Apni Dukan team" | e2e:signin "an admin taken off the team meanwhile…" | OK-tested |
| 10 | A token without an admin role reaches `/admin` | 403 (security config) | Same not-on-the-team screen (AdminGate treats 403 like 404) | — (the app never calls `/admin` for `NONE`) | OK-untested |
| 11 | Access token expired | 401 → `POST /auth/refresh` 200 | Carries on; one refresh shared by calls made together, never the same refresh token twice across tabs | e2e:signin "an expired session refreshes once…"; unit:client.test | OK-tested |
| 12 | Refresh refused (expired, reused) | 401 | Back to sign-in; cached data forgotten | e2e:signin "a refused refresh signs out…"; unit:client.test "signs out when the refresh token is refused" | OK-tested |
| 13 | Sign out | `POST /auth/logout` 204 | Sign-in screen; `ada.session` removed | e2e:signin "More shows the name, phone and role, and signs out" | OK-tested |
| 14 | Sign-out or another person's sign-in in another tab | storage event | This tab follows and forgets the person (partner app's code) | — | OK-untested |
| 15 | Storage keys | — | `ada.session`, `ada.returnTo`, `ada.device`: never shares the partner (`adp.*`) or customer app's session | unit:client.test; unit:flow.test | OK-tested |
| 16 | A link opened while signed out | — | Sign in, then back to that link | unit:flow.test "takes an admin through email…" | OK-tested |
| 17 | Address that doesn't exist | — | "Page not found" with a link to the dashboard | e2e:signin "a page that does not exist says so" | OK-tested |

## Test-mode banner

| # | Scenario | What the API answers | What the screen shows | Test | Verdict |
|---|---|---|---|---|---|
| 18 | Test mode on | `GET /admin/me` `testMode: {on: true, until}` | Red banner on every screen: "OTP test mode is on until 6:30 PM" (India time) | e2e:super "an ordinary admin sees the banner…"; e2e:super "test mode: switch on…" | OK-tested |
| 19 | Ends after midnight India time | `until` tomorrow | "…until tomorrow 1:00 AM" (or the date further out) | unit:lib.test "writes the test-mode banner…" | OK-tested |
| 20 | End time passes while a screen is open | — | Banner goes by itself (checked every 15 s), and `/admin/me` is re-read every minute and on focus | unit:lib.test "shows the banner only while…" | OK-tested |
| 21 | Switched off by someone else | next `/admin/me` `on: false` | Banner goes | e2e:super "an ordinary admin sees the banner…" | OK-tested |

## Dashboard and lists

| # | Scenario | What the API answers | What the screen shows | Test | Verdict |
|---|---|---|---|---|---|
| 22 | Dashboard | `GET /admin/dashboard` 200 counts per type and group | Kirana / Salon tabs (kept in the address), five counts, each a link to its list | e2e:shops "the dashboard shows the five counts…" | OK-tested |
| 23 | DRAFT without a reason (registration not finished) | in no group | Not counted | e2e:shops "the dashboard shows the five counts…" | OK-tested |
| 24 | Dashboard loading, error, offline | slow; 4xx; no network | Spinner; message with Try again; "You're offline…" (network and 5xx retried twice first) | e2e:shops "dashboard: loading, then an error…" | OK-tested |
| 25 | List for a type and group | `GET /admin/shops?type&group` oldest first | Cards: shop number, name, area and city, how long, Re-check badge for RECHECK | e2e:shops "the list: oldest first…" | OK-tested |
| 26 | How long it has waited | AdminShop has no "entered its status" time | Uses `statusSince` if the backend adds it, else `createdAt` ("Waiting 3 days" may count from registration, not from the last submit) | e2e:shops "the list: oldest first…"; unit:lib.test "says how long…" | GAP (the contract has no status time; to raise with the backend: add `statusSince`) |
| 27 | Search | `q`: shop number exactly, or name / owner / phone contains | One request after typing stops (300 ms); kept in the address for Back | e2e:shops "search asks once typing stops…" | OK-tested |
| 28 | No match, empty group | 200 `[]` | "No shop matches" / "Nothing here" | e2e:shops "search asks once…" | OK-tested |
| 29 | List error, offline | 400; no network | Message with Try again | e2e:shops "the list: error with Try again, offline…" | OK-tested |
| 30 | More than 100 in a group | at most 100 | "Showing the oldest 100. Search to find a shop further down." | — | OK-untested |
| 31 | Wrong type or group in the address | — (not sent) | Dashboard | e2e:shops "the list: error… a wrong address…" | OK-tested |

## Shop page and decisions

| # | Scenario | What the API answers | What the screen shows | Test | Verdict |
|---|---|---|---|---|---|
| 32 | Owner edited an approved shop | `changes` non-empty, `pinMovedMetres`, previous photo URLs | "What changed" first: old → new per field ("(empty)" for none), "Pin moved 350 m", old and new photos side by side | e2e:detail "a re-check shows what changed first…" | OK-tested |
| 33 | First visit | `changes: []` | No "What changed" | e2e:detail "a first visit: photos enlarge…" | OK-tested |
| 34 | Photos | short-lived URLs | Tap to enlarge, Close; page re-read every 4 min; an expired link says so instead of a broken image | e2e:detail "a first visit…" (enlarge) | OK-tested (expiry text OK-untested) |
| 35 | Navigate, Call owner | lat/lng, `ownerPhone` | Google Maps directions in a new tab; `tel:+91…`; no phone: "No phone number" | e2e:detail "a first visit…"; unit:lib.test "builds the Maps…" | OK-tested |
| 36 | Salon counts | `salon: {barbers, services}` (null for kirana) | Barbers and Services rows | e2e:detail "a first visit…" | OK-tested |
| 37 | Timeline | newest first; `note` admins only; `EDITED` | Newest first; notes boxed "Only admins see this"; EDITED as "Owner changed it after approval"; reason as "Owner was told" | e2e:detail "a re-check shows…"; unit:lib.test "names timeline events…" | OK-tested |
| 38 | Buttons by status | — | PENDING_VISIT: Approve, Send back, Suspend; APPROVED: Suspend; SUSPENDED: Reinstate; DRAFT: none; Add note always | e2e:detail "a first visit…", "send back…", "suspend a live shop…"; unit:lib.test "offers the decisions…" | OK-tested |
| 39 | Approve with an optional note | `POST …/approve {version, note?}` 200 AdminShop | "Approved. The shop is live now."; buttons, timeline and counts follow | e2e:detail "approve with an optional note…" | OK-tested |
| 40 | Send back: checklist, reason, note | `POST …/reject {version, reason, note?, checklist}` 200 | Reason started from the ticks until typed by hand; checks 2–200 and ≤500 before sending | e2e:detail "send back: checklist…"; unit:lib.test "checks a reason…" | OK-tested |
| 41 | Suspend a live shop; reinstate | `…/suspend`, `…/reinstate` 200 | Reinstated shop waits in "Re-check after edit" | e2e:detail "suspend a live shop, then reinstate it…" | OK-tested |
| 42 | Suspend straight from a visit | `…/suspend` allowed from PENDING_VISIT | Suspend button on a waiting shop | e2e:detail "a first visit…" (button shown) | OK-tested |
| 43 | Field refused by the backend | 400 VALIDATION_FAILED `details: {field: message}` | "The reason must not contain links." under the field and in the sheet | e2e:detail "a backend field refusal is spelled out…" | OK-tested |
| 44 | Owner changed the shop meanwhile | 409 SHOP_CHANGED | "The owner changed something; reload and check again" with Reload; typed reason kept; next try sends the new version | e2e:detail "409 SHOP_CHANGED…" | OK-tested |
| 45 | Someone else decided first | 409 WRONG_STATUS | Says so and reloads: the new status's buttons | e2e:detail "409 WRONG_STATUS…" | OK-tested |
| 46 | Double tap on a decision | — | Sends once | e2e:detail "a double tap on Approve sends once" | OK-tested |
| 47 | Add note | `POST …/notes {note}` 201 TimelineEntry | Needs text, ≤500; double tap adds one; shown as admins-only | e2e:detail "add a note…" | OK-tested |
| 48 | Shop doesn't exist; page fails | 404 NOT_FOUND; other error | "No such shop"; message with Try again | e2e:detail "a shop that does not exist…" | OK-tested |
| 49 | Which version is sent | — | The version on screen when the sheet opened (a background re-read doesn't change it) | e2e:detail "409 SHOP_CHANGED…" (versions 3 then 4) | OK-tested |

## Support

| # | Scenario | What the API answers | What the screen shows | Test | Verdict |
|---|---|---|---|---|---|
| 50 | Look up strikes by phone | `POST /admin/salon/strikes/lookup {phone}` 200 | Blocked until (or not blocked), each strike: kind, booking, salon, when | e2e:support "support looks up a customer's strikes…" | OK-tested |
| 51 | No customer with that number | 404 CUSTOMER_NOT_FOUND | "No customer has an account with this number." | e2e:support "support: a number with no customer account…" | OK-tested |
| 52 | Remove a strike with a reason | `POST …/{appointmentId}/remove {reason}` 204 | Reason checked (2–200, assumed), looked up again, "Strike … removed."; double tap removes once | e2e:support "support looks up…" | OK-tested |
| 53 | No strikes; offline | 200 `strikes: []`; no network | "No strikes."; "You're offline…" | e2e:support "support: a number with no customer account…" | OK-tested |

## Super admin: Team and Test mode

| # | Scenario | What the API answers | What the screen shows | Test | Verdict |
|---|---|---|---|---|---|
| 54 | Ordinary admin | — | No Team or Test mode tab; `/team` and `/test-mode` go to the dashboard; no call made | e2e:super "an ordinary admin has no Team or Test mode…" | OK-tested |
| 55 | Super admin made an ordinary admin meanwhile | 403 SUPER_ADMIN_ONLY | `/admin/me` re-read; sent to the dashboard, tabs go | e2e:super "a super admin made an ordinary admin meanwhile…" | OK-tested |
| 56 | Team list | `GET /admin/team` super admin first | Name, phone, role, since; "(you)"; no Remove on the super admin | e2e:super "team: list with the super admin first…" | OK-tested |
| 57 | Add an admin by phone | `POST /admin/team {phone}` 201; 409 ALREADY_ADMIN; 409 TEST_PHONE | "…is an admin now."; the two refusals in words | e2e:super "team: list…" | OK-tested |
| 58 | Remove an admin | `DELETE /admin/team/{userId}` 204 | Confirm first ("signed out at once"); Cancel sends nothing | e2e:super "team: list…" | OK-tested |
| 59 | Remove the super admin | 409 CANT_REMOVE_SUPER_ADMIN | "The super admin can't be removed from the team." | e2e:super "team: removing someone who became the super admin…" | OK-tested |
| 60 | Test mode state and warning | `GET /admin/test-mode` | On/Off, until and who switched it on, the warning that test numbers sign in with any code | e2e:super "test mode: switch on…" | OK-tested |
| 61 | Switch on for 1–8 hours | `PUT /admin/test-mode {hours}` 200 | Picker 1–8 only; banner appears at once everywhere | e2e:super "test mode: switch on…"; unit:lib.test "checks… the hours" | OK-tested |
| 62 | Change the end while on | `PUT` again | "Keep on for N hours from now" | — | OK-untested |
| 63 | Switch off | `DELETE /admin/test-mode` 200 | Banner goes | e2e:super "test mode: switch on…" | OK-tested |
| 64 | Test numbers | `phones: [{phone, label, addedAt, hasAccount}]` | Number, label, "Has an account" / "No account yet" | e2e:super "test numbers: add with a label…" | OK-tested |
| 65 | Add a test number | `POST …/phones {phone, label}` 201; 409 ADMIN_PHONE; 409 ALREADY_TEST_PHONE | Checks number and label first; the two refusals in words | e2e:super "test numbers…" | OK-tested |
| 66 | Remove a test number | `DELETE …/phones/{phone}` 200 state | "…is no longer a test number." | e2e:super "test numbers…" | OK-tested |
| 67 | Team or test mode fails to load | error | Message with Try again | e2e:super "team and test mode: loading errors…" | OK-tested |

## Not in v1

| # | Scenario | Verdict |
|---|---|---|
| 68 | Offline use, home-screen install (no service worker) | N/A-v1 |
| 69 | Editing a shop's details for the owner | N/A-v1 (the owner edits in the partner app) |
| 70 | Light theme | N/A-v1 (dark only) |
