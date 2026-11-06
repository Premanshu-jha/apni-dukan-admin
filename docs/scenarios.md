# Admin scenarios

Scope: every situation someone from the Apni Dukan team (or someone who isn't) can hit on the admin website, checked
against the admin API contract (backend PR "Admin roles, OTP test mode, field-visit pages") and this app (`src/**`).
"What the API answers" comes from the contract; the fake backend `e2e/mockApi.ts` answers the same. Backend tests are
JUnit methods in `apni-dukan-backend` branch `feature/admin`, `src/test/java/in/apnidukan/admin/AdminIntegrationTest.java`
(written `AdminIT.<method>`). App tests are Vitest (`unit:<file> "<it>"`) and Playwright (`e2e:<spec> "<title>"`).

Verdicts: **OK-tested**, **OK-untested** (correct but no test), **GAP** (wrong or missing, with why), **N/A-v1** (a v1
limit the README states, or nothing for this site to do).

How to use it: every new feature or fix adds or updates rows. A row is done when both the API and the screen behave
as written and a test proves it (a test that would fail if the behaviour broke). Reviews walk this list against the
code.

Updated 2026-11-05 after the independent reviews (contract update: `statusSince`, order of checks, text rule, new
error codes, test-mode rules). Updated 2026-11-06 for the backend's scale PR (#31): lists 50 a page (rows 30, 36,
90–94) and ETags (95–96).

## Sign-in and session

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 1 | Admin signs in with phone and code | `POST /auth/otp/send` 202; `/auth/otp/verify` 200 tokens, `user.adminRole: ADMIN` | Phone → code → dashboard | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:signin "an admin signs in with phone and code…" | OK-tested |
| 2 | Not a valid Indian mobile number | — (not sent) | Send code stays off | — | unit:PhoneStep.test "only allows sending a code…" | OK-tested |
| 3 | Wrong code | 400 WRONG_CODE with tries left | The backend's words; the code box is really empty for the next try | — | e2e:signin "an admin signs in…" (`toHaveValue('')`, then typed key by key) | OK-tested |
| 4 | Robot check (Turnstile) when a site key is set | 400 CAPTCHA_REQUIRED / CAPTCHA_FAILED | Widget shown, Send code waits for it, fresh token after any failure (partner app's code). Allowed by the CSP (script and frame from challenges.cloudflare.com; checked by hand with a stubbed widget) | — | — | OK-untested (e2e runs without a site key) |
| 5 | Signed in, `adminRole: NONE` (existing or brand-new account) | tokens with `adminRole: NONE` | "This is for the Apni Dukan team" on every address, Check again and Sign out; no email or name steps; no `/admin` call | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:signin "someone not on the team sees…"; unit:flow.test "sends someone not on the team…" | OK-tested |
| 6 | Not on the team, then added by the super admin | refresh gives `adminRole: ADMIN` (their other sessions end: they sign in again) | Check again lets them in | AdminIT.theSuperAdminCantDeleteTheirAccountAndANewAdminSignsInAfresh | e2e:signin "someone added to the team while on the…" | OK-tested |
| 7 | New admin with no verified email or name | tokens, email missing | Email step, then name step, then the dashboard | — | e2e:signin "a new admin without a verified email…" | OK-tested |
| 8 | Lost phone: recovery with email | `/auth/recover/start` 202; `/recover/complete` 200 tokens or 400 WRONG_CODE | Two codes, then in; a wrong code says so | — | e2e:signin "recovery with email…" | OK-tested |
| 9 | Taken off the team while the site is open | Old access token 401; refresh 200 with `adminRole: NONE`; `/admin/me` 403 | "This is for the Apni Dukan team"; the saved sign-in now says NONE | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:signin "taken off the team: the old token gets 401…" | OK-tested |
| 10 | Taken off the team while the revocation list (Redis) is down | Old token still accepted; `/admin/me` 404 NOT_FOUND | The open session moves to "not for the team" at the next minute's `/admin/me`, with no click or reload | AdminIT.aTokenFromBeforeTheAdminWasRemovedInTheDatabaseIsRefused | e2e:signin "an open session whose next /admin/me answers 404…" (page.clock) | OK-tested |
| 11 | Access token expired | 401 → `POST /auth/refresh` 200 | Carries on; one refresh shared by calls made together, never the same refresh token twice across tabs | — | e2e:signin "an expired session refreshes once…"; unit:client.test | OK-tested |
| 12 | Refresh refused (expired, reused) | 401 | Back to sign-in; the cache is cleared: signing in again and opening the same list with the backend refusing shows only the error, never the old shop | — | e2e:signin "a refused refresh signs out, and the next sign-in sees none of the old data"; unit:client.test | OK-tested |
| 13 | Sign out | `POST /auth/logout` 204 (sent in the background, 4 s limit) | Session and cache cleared first, sign-in screen at once even when logout is slow; no old data after signing in again | — | e2e:signin "More shows…; sign-out is immediate… and leaves no cached data" | OK-tested |
| 14 | Sign-out or another person's sign-in in another tab | storage event | This tab follows and forgets the person (partner app's code) | — | — | OK-untested |
| 15 | Storage keys | — | `ada.session`, `ada.returnTo`, `ada.device`: never shares the partner (`adp.*`) or customer app's session | — | unit:client.test; unit:flow.test | OK-tested |
| 16 | A shop link opened while signed out | — | The SignedIn guard saves it (`ada.returnTo`), sign-in opens it, then it is forgotten | — | e2e:signin "a shop link opened while signed out is kept by the guard…" | OK-tested |
| 17 | Address that doesn't exist | — | "Page not found" with a link to the dashboard | — | e2e:signin "a page that does not exist says so" | OK-tested |
| 18 | A test account after test mode ends, is switched off, or its number is removed | refresh 401 TEST_MODE_OFF | Signed out (sign-in screen, session removed) | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | e2e:signin "a test account is signed out when test mode ends…", "a test account is signed out when its number is removed while it is signed in…"; unit:client.test "treats a refresh refused with 401 TEST_MODE_OFF…" | OK-tested |
| 19 | Test mode switched off while someone is on the code screen with a test number | `/auth/otp/verify` with any code: 400 WRONG_CODE (the real code is needed again; none was sent) | The backend's words; they ask for a new code (sent by SMS as usual) | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | — | OK-untested |
| 20 | Super admin tries to delete their own account | 409 SUPER_ADMIN (backend) | Nothing on this site: account deletion is in the customer and partner apps | AdminIT.theSuperAdminCantDeleteTheirAccountAndANewAdminSignsInAfresh | — | N/A-v1 |
| 21 | Writes refused with 404 (removed) or 403 SUPER_ADMIN_ONLY | 404 / 403 | Every admin write goes through one path that re-reads `/admin/me` at once, so the guard moves them on | — | e2e:detail "a write refused with 404…"; e2e:super "a write refused with 403 SUPER_ADMIN_ONLY…" | OK-tested |

## Test-mode banner

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 22 | Test mode on | `GET /admin/me` `testMode: {on: true, until}` | Red banner on every screen: "OTP test mode is on until 6:30 PM" (India time) | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | e2e:super "test mode: switch on…" | OK-tested |
| 23 | Ends after midnight India time | `until` tomorrow | "…until tomorrow 1:00 AM" (or the date further out) | — | unit:lib.test "writes the test-mode banner…" | OK-tested |
| 24 | Switched on or off elsewhere while a screen is open | next `/admin/me` | Re-read every minute and when coming back to the app (once 15 s old); banner follows with no reload | — | e2e:super "the banner follows /admin/me by itself…" (page.clock) | OK-tested |
| 25 | End time passes while a screen is open | — | Banner goes by itself (checked every 15 s) | — | e2e:super "the banner goes by itself when the end time passes" (page.clock); unit:lib.test "shows the banner only while…" | OK-tested |

## Dashboard and lists

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 26 | Dashboard | `GET /admin/dashboard` 200 counts per type and group | Kirana / Salon tabs (kept in the address), five counts, each a link to its list | AdminIT.theDashboardCountsEachGroupAndTheListsSearch | e2e:shops "the dashboard shows the five counts…" | OK-tested |
| 27 | DRAFT without a reason (registration not finished) | in no group | Not counted | AdminIT.theDashboardCountsEachGroupAndTheListsSearch | e2e:shops "the dashboard shows the five counts…" | OK-tested |
| 28 | Dashboard loading and error | slow; 4xx | Spinner; message with Try again (network and 5xx retried twice first) | — | e2e:shops "dashboard: loading, then an error with Try again…" | OK-tested |
| 29 | Dashboard offline, after the app has loaded | no network | "You're offline…" with Try again, no counts; works again once back online | — | e2e:shops "dashboard's own offline state, after the app has loaded" | OK-tested |
| 30 | List for a type and group | `GET /admin/shops?type&group` longest in its group first (by `statusSince`, then id), 50 a page | Cards: shop number, name, area and city, how long, Re-check badge for RECHECK | AdminIT.editsMadeWhileLiveShowAtTheReCheckAndTheQueueKeepsItsOrder | e2e:shops "the list: oldest first…" | OK-tested |
| 31 | How long it has waited | `statusSince` on every AdminShop | "Waiting 3 days", "Waiting 2 h", "Sent back 20 min ago", "Live for 1 day" from `statusSince` | AdminIT.editsMadeWhileLiveShowAtTheReCheckAndTheQueueKeepsItsOrder | e2e:shops "the list: oldest first…"; unit:lib.test "says how long…" | OK-tested |
| 32 | Search | `q`: name / owner name contains | One request after typing stops (300 ms); kept in the address for Back | AdminIT.theDashboardCountsEachGroupAndTheListsSearch | e2e:shops "search asks once typing stops…" | OK-tested |
| 33 | Search by "#1042" or a phone typed with +91, spaces or dashes | shop number exactly ("1042" or "#1042"); owner phone in part, "+91", spaces, dashes ignored | The matching shop | AdminIT.theDashboardCountsEachGroupAndTheListsSearch (number and phone part; not "#" or "+91") | e2e:shops "search by \"#1042\" and by a phone typed with +91…" | OK-tested |
| 34 | No match, empty group | 200 `[]` | "No shop matches" / "Nothing here" | — | e2e:shops "search asks once…" | OK-tested |
| 35 | List error, offline | 400; no network | Message with Try again | — | e2e:shops "the list: error with Try again, offline…" | OK-tested |
| 36 | More than 50 in a group | 200, pages of 50; the next page with `afterSince` + `afterId` = the last shop's `statusSince` (exactly as received) and id | "First 50 shops, longest waiting first" and "Show more shops" until a page is shorter than 50, then "N shops"; every shop once, in order, ties at a page's end broken by id | AdminIT.aLongListComesFiftyAPageInOrderWithNothingTwiceOrLeftOut | e2e:shops "120 shops come 50 at a time over 3 pages…" | OK-tested |
| 37 | Wrong type or group in the address | — (not sent) | Dashboard | — | e2e:shops "the list: error… a wrong address…" | OK-tested |
| 90 | Exactly 50 in a group | 200 [50], then 200 [] | One extra page, then "50 shops" and no button | — | e2e:shops "exactly 50 shops…" | OK-tested |
| 91 | "Show more shops" fails (5xx, offline) | 500; no network | The shops already shown stay (no error screen); "Couldn't load more shops…" or "You're offline…"; the button says "Loading more shops…" with aria-busy (still focusable) while it loads; tapping again works. A tap while the phone says it is offline says so at once and sends nothing; that note goes with a new search, group or type, or once a page loads | — | e2e:shops "a failed \"Show more shops\" keeps the list…", "\"Show more shops\" while the phone says it is offline…" | OK-tested |
| 92 | Keyboard or screen reader on "Show more shops" | — | Focus moves to the first new shop; when the last page was empty (the button goes) focus moves to the count; after a failed page it stays on the button; the count is announced | — | e2e:shops "120 shops come 50 at a time…", "exactly 50 shops…", "a failed \"Show more shops\"…" (focus) | OK-tested |
| 93 | A new search, group or type while pages are loaded | the first page again (no cursor) | Starts from the first 50 of the new list | — | e2e:shops "a search starts again from the first page" | OK-tested |
| 94 | Half a cursor, or one that can't be read | Half: 400 VALIDATION_FAILED `{afterId: "send afterSince and afterId together"}`. Unreadable (e.g. `afterSince=yesterday`, a broken id): 400 BAD_REQUEST "'yesterday' is not a valid value for 'afterSince'", empty details (checked first) | — (the app always sends both, as received) | AdminIT.aLongListComesFiftyAPageInOrderWithNothingTwiceOrLeftOut | e2e:shops "the fake backend refuses half or unreadable cursors…" | OK-tested |

## Shop page and decisions

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 38 | Owner edited an approved shop | `changes` non-empty, `pinMovedMetres`, previous photo URLs; timeline EDITED | "What changed" first: old → new per field ("(empty)" for none), "Pin moved 350 m", old and new photos side by side; EDITED as "Owner changed it after approval" | AdminIT.aReCheckShowsWhatChangedSinceApprovalAndTheTimeline | e2e:detail "a re-check shows what changed first…" | OK-tested |
| 39 | First visit | `changes: []` | No "What changed" | AdminIT.aReCheckShowsWhatChangedSinceApprovalAndTheTimeline | e2e:detail "a first visit: photos enlarge…" | OK-tested |
| 40 | Photos | short-lived https URLs | Tap to enlarge; the page is re-read every 4 min; an expired link says so instead of a broken image | — | e2e:detail "a first visit…" (enlarge) | OK-tested (expiry text OK-untested) |
| 41 | Photo dialog with a keyboard | — | Focus stays on Close, Escape closes wherever focus is, focus returns to the thumbnail | — | e2e:detail "the photo dialog keeps focus on Close…" | OK-tested |
| 42 | A shop with no photos | `ownerPhotoUrl` / `shopPhotoUrl` null | "No shop photo", "No owner photo"; nothing to enlarge | — | e2e:detail "a shop with no photos says so…" | OK-tested |
| 43 | Navigate, Call owner | lat/lng, `ownerPhone` | Google Maps directions in a new tab; `tel:+91…`; no phone: "No phone number" | — | e2e:detail "a first visit…"; unit:lib.test "builds the Maps…" | OK-tested |
| 44 | Salon counts | `salon: {barbers, services}` (null for kirana) | Barbers and Services rows | — | e2e:detail "a first visit…" | OK-tested |
| 45 | Timeline | newest first; `note` admins only | Newest first; notes boxed "Only admins see this"; reason as "Owner was told" | AdminIT.aReCheckShowsWhatChangedSinceApprovalAndTheTimeline | e2e:detail "a re-check shows…"; unit:lib.test "names timeline events…" | OK-tested |
| 46 | Times shown in India time | UTC instants | India time whatever the phone's zone (timeline "Thu 5 Nov, 6:30 PM", registered "2 Nov 2026" for 19:00 UTC on 1 Nov) | — | e2e:detail "times are shown in India time" (phone in New York); unit:lib.test "writes times in India time" | OK-tested |
| 47 | Buttons by status | — | PENDING_VISIT: Approve, Send back, Suspend; APPROVED: Suspend; SUSPENDED: Reinstate; DRAFT: none; Add note always | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "a first visit…", "send back…", "suspend a live shop…"; unit:lib.test "offers the decisions…" | OK-tested |
| 48 | Approve with an optional note | `POST …/approve {version, note?}` 200 AdminShop | "Approved. The shop is live now."; buttons and timeline follow; Back through the app (within the lists' 10 s freshness) shows the list and counts already updated | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "approve with an optional note… without a reload" | OK-tested |
| 49 | Send back: checklist, reason, note | `POST …/reject {version, reason, note?, checklist}` 200 | Reason started from the ticks until typed by hand; checks before sending | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "send back: checklist…" | OK-tested |
| 50 | Text rule for reason and note | 400 VALIDATION_FAILED (TextCleaner: NFKC; hidden characters refused; spaces collapsed; at least 2 letters or digits; 2–200 reason / 2–500 note when given, in code points). Checked after status and version | The same rule before sending ("Contains invisible or special characters", "Write at least 2 letters or digits"); sent cleaned; an empty note means none | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "the text rule…"; unit:lib.test "follows the backend's TextCleaner…", "needs at least 2 letters or digits…" | OK-tested |
| 51 | Suspend a live shop; reinstate | `…/suspend`, `…/reinstate` 200 | Reinstated shop waits in "Re-check after edit" | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "suspend a live shop, then reinstate it…" | OK-tested |
| 52 | Field refused by the backend | 400 VALIDATION_FAILED `details: {field: message}` | "The reason must not contain links." under the field and in the sheet | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "a backend field refusal is spelled out…" | OK-tested |
| 53 | The shop changed since it was opened (owner, or another admin with the status still allowed) | 409 SHOP_CHANGED (checked after fields and status) | "This shop changed since you opened it (the owner or another admin). Reload and check again." Decision buttons off until Reload works; a failed reload keeps the banner and says why; typed reason kept; next try sends the new version; dashboard, lists and the shop refreshed | AdminIT.editsMadeWhileLiveShowAtTheReCheckAndTheQueueKeepsItsOrder | e2e:detail "409 SHOP_CHANGED: decisions stay off until Reload works…" | OK-tested |
| 54 | Two admins at once: the other decided first | 409 WRONG_STATUS `details.status` (checked before the version) | "Someone else decided meanwhile: it is now Live."; the shop is re-read at once with its new buttons; dashboard and lists refreshed (Back shows them updated); a failed re-read keeps the buttons off until Reload works | AdminIT.whenAnotherAdminDecidedFirstTheSecondIsToldSoNotThatTheOwnerChangedIt | e2e:detail "409 WRONG_STATUS: another admin decided first…", "WRONG_STATUS whose re-read fails…" | OK-tested |
| 55 | Which version is sent | — | The version on screen when the sheet opened: a background re-read while the sheet is open doesn't change it, so a change the admin hasn't seen is refused (409), never approved blind | — | e2e:detail "the version sent is the one on screen when the sheet opened, even after a background re-read" | OK-tested |
| 56 | Weak network: the answer is lost but the decision went through | (decision done); answer never arrives | The shop is re-read; its status shows the decision, so success is shown and everything refreshed; sent once | — | e2e:detail "weak network: the answer to Approve is lost but it went through…" | OK-tested |
| 57 | Weak network: nothing went through | no network | The re-read fails or shows no change: the form stays with what was typed and says "You're offline…"; sending again works | — | e2e:detail "weak network: offline when sending…" | OK-tested |
| 58 | Admin removed mid-decision | 401 → refresh NONE → 403 | "This is for the Apni Dukan team"; nothing decided | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:detail "an admin taken off the team mid-decision…" | OK-tested |
| 59 | Double tap on a decision | — | Sends once | — | e2e:detail "a double tap on Approve sends once" | OK-tested |
| 60 | Add note | `POST …/notes {note}` 201 TimelineEntry (text rule 2–500) | Needs 2+ letters or digits, ≤500; double tap adds one; shown as admins-only | AdminIT.decisionsCheckWhatTheyAreGiven | e2e:detail "add a note…" | OK-tested |
| 61 | Shop doesn't exist; page fails | 404 NOT_FOUND; other error | "No such shop"; message with Try again | — | e2e:detail "a shop that does not exist…" | OK-tested |
| 62 | Very long names, URLs and notes at 360px | — | Titles, sheet titles, cards, team names, labels, notes and values wrap; no sideways scroll (40-letter name with no spaces, a long URL) | — | e2e:layout "at 360px a 40-letter name…" (scrollWidth ≤ clientWidth) | OK-tested |

## Support

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 63 | Look up strikes by phone | `POST /admin/salon/strikes/lookup {phone}` 200 | Blocked until (or not blocked), each strike: kind, booking, salon, when | — | e2e:support "support looks up a customer's strikes…" | OK-tested |
| 64 | Double submit of a lookup | — | One lookup sent | — | e2e:support "support: a double submit sends one lookup…" | OK-tested |
| 65 | No customer with that number | 404 CUSTOMER_NOT_FOUND | "No customer has an account with this number." | — | e2e:support "support: a number with no customer account…" | OK-tested |
| 66 | Badly formed phone (backend check) | 400 INVALID_PHONE (no details) | Shown on the phone field | — | e2e:support "support: a double submit… INVALID_PHONE on the field…"; unit:errors.test "puts INVALID_PHONE… on the phone field" | OK-tested |
| 67 | Remove a strike with a reason | `POST …/{appointmentId}/remove {reason}` 204 (text rule 2–200) | Reason checked, sent cleaned, looked up again, "Strike … removed."; double tap removes once | — | e2e:support "support looks up…" | OK-tested |
| 68 | Strike removed meanwhile | 404 STRIKE_NOT_FOUND | "This strike was already removed, maybe by someone else." and the list as it is now | — | e2e:support "support: a double submit… a strike removed meanwhile" | OK-tested |
| 69 | No strikes; offline | 200 `strikes: []`; no network | "No strikes."; "You're offline…" | — | e2e:support "support: a number with no customer account…" | OK-tested |

## Super admin: Team and Test mode

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 70 | Ordinary admin | — | No Team or Test mode tab; `/team` and `/test-mode` go to the dashboard; no call made | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:super "an ordinary admin has no Team or Test mode…" | OK-tested |
| 71 | Super admin made an ordinary admin meanwhile | 403 SUPER_ADMIN_ONLY (read or write) | `/admin/me` re-read at once; sent to the dashboard, tabs go | AdminIT.thereIsAtMostOneSuperAdmin | e2e:super "a super admin made an ordinary admin meanwhile…", "a write refused with 403 SUPER_ADMIN_ONLY…" | OK-tested |
| 72 | Team list | `GET /admin/team` super admin first; `since` = when they became an admin | Name, phone, role, "admin since …"; "(you)"; no Remove on the super admin | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:super "team: list with the super admin first…" | OK-tested |
| 73 | Add an admin by phone | `POST /admin/team {phone}` 201; 409 ALREADY_ADMIN; 400 INVALID_PHONE | "…is an admin now."; ALREADY_ADMIN in words; INVALID_PHONE on the field | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:super "team: list…" | OK-tested |
| 74 | A test number, or an account made in test mode, as an admin | 409 TEST_PHONE | "This is a test number, or an account made in test mode, so it can't be an admin." | AdminIT.aRealAccountsNumberCantBecomeATestNumberAndATestAccountCantBecomeAnAdmin | e2e:super "team: list…" | OK-tested |
| 75 | Remove an admin | `DELETE /admin/team/{userId}` 204 | Confirm first ("signed out at once"); Cancel sends nothing | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:super "team: list…" | OK-tested |
| 76 | Remove the super admin | 409 CANT_REMOVE_SUPER_ADMIN | "The super admin can't be removed from the team." | AdminIT.theSuperAdminAddsAndRemovesAdminsAndOnlyHeCan | e2e:super "team: removing someone who became the super admin…" | OK-tested |
| 77 | Test mode state and rules | `GET /admin/test-mode` | On/Off, until and who switched it on; the page says: only numbers nobody has signed in with can be added; while on they sign in with any 6-digit code (no SMS); email codes are always real; test accounts are signed out when it ends or the number is removed | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | e2e:super "test mode: switch on…" | OK-tested |
| 78 | Switch on for 1–8 hours | `PUT /admin/test-mode {hours}` 200 | Picker 1–8 only; banner appears at once everywhere | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | e2e:super "test mode: switch on…"; unit:lib.test "checks… the hours" | OK-tested |
| 79 | Change the end while on | `PUT` again | "Keep on for N hours from now" | — | — | OK-untested |
| 80 | Switch off | `DELETE /admin/test-mode` 200 | Banner goes | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | e2e:super "test mode: switch on…" | OK-tested |
| 81 | Test numbers | `phones: [{phone, label, addedAt, hasAccount}]` | Number, label, "Has an account" / "No account yet" | — | e2e:super "test numbers: add with a label…" | OK-tested |
| 82 | Add a test number | `POST …/phones {phone, label}` 201; 409 ADMIN_PHONE; 409 ALREADY_TEST_PHONE; 400 INVALID_PHONE; label text rule 2–60 | Checks number and label first; the refusals in words | AdminIT.anAdminsNumberIsNeverATestNumber | e2e:super "test numbers…" | OK-tested |
| 83 | A number with a real account as a test number | 409 REAL_ACCOUNT | "That number already has a real account (a customer or a shop). Use a number nobody has signed in with." | AdminIT.aRealAccountsNumberCantBecomeATestNumberAndATestAccountCantBecomeAnAdmin | e2e:super "test numbers…" | OK-tested |
| 84 | Remove a test number | `DELETE …/phones/{phone}` 200 state (its test account is signed out) | "…is no longer a test number; its test account was signed out." | AdminIT.testNumbersSignInWithAnyCodeOnlyWhileTestModeIsOn | e2e:super "test numbers…" | OK-tested |
| 85 | Team or test mode fails to load | error | Message with Try again | — | e2e:super "team and test mode: loading errors…" | OK-tested |

## Site-wide

| # | Scenario | What the API answers | What the screen shows | Backend test | App test | Verdict |
|---|---|---|---|---|---|---|
| 86 | Content-Security-Policy | — | Only this site's scripts and Cloudflare Turnstile run; API over https (plus localhost and the e2e fake); images from https. Every e2e test fails if the policy blocks anything | — | every e2e test (`cspClean` fixture in e2e/helpers.ts) | OK-tested |
| 87 | Offline use, home-screen install (no service worker) | — | — | — | — | N/A-v1 |
| 88 | Editing a shop's details for the owner | — | — (the owner edits in the partner app) | — | — | N/A-v1 |
| 89 | Light theme | — | — (dark only) | — | — | N/A-v1 |
| 95 | A screen re-read with nothing changed | Every GET 200 carries an `ETag`; sent back as `If-None-Match`, 304 with no body (`Cache-Control: no-store` stays) | The client keeps the last ETag and data per address in memory only (per person, at most 200) and shows the kept data on 304: no error, no retry; a 304 with nothing kept for it (a proxy, or the person changed meanwhile) is asked once more without If-None-Match (no-store) | AdminIT.anUnchangedAnswerIsA304WithNoBodyAndAChangeGivesANewOne | e2e:shops "a refresh answered 304…"; unit:client.test "sends the kept ETag…", "keeps at most 200…", "asks once more for the whole answer…" | OK-tested |
| 96 | Sign-out, session ended, or another person signs in | — | The kept answers are forgotten with the session; one arriving after sign-out is not kept | — | unit:client.test "forgets everything on sign-out…", "…when another tab signs out (the storage event)", "a 304 arriving after sign-out…", "does not keep an answer that arrives after sign-out" | OK-tested |
