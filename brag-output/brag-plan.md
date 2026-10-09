# Brag Plan: G4 Dental Clinic

## What is this app?
A web-based appointment scheduling and attendance tracking system for a small dental clinic: patients request a visit online with no account, staff confirm it onto a schedule that refuses double bookings, and the clinic finally gets a no-show report. A BSCS thesis project (PLM), and a real, deployed, tested app.

## The angle
"The logbook is closed." Small clinics run on a paper logbook, phone calls and chat messages. This video shows the same three things the paper's SOPs promise, but *working*: a patient taps a slot on a phone, staff click Confirm on a desktop, and the schedule and the monthly report fill themselves in. No claims beyond what the UI already says. The app is calm and clinical, so the video is calm and clinical: white cards, one teal accent, and the product doing its job.

## Hook (first 2-3 seconds)
Teal tooth mark + "G4 Dental Clinic" settle in on the canvas, then the line from the paper's problem statement, played straight:
**"Small dental clinics still book on paper."** Beat. **"Not this one."** The second line cuts to the phone booking form sliding up.

## Key moments (the middle)
- The phone booking form (Figure 3.8): calendar on October 2026, then the open-time chips. A finger taps **10:00 AM** and it fills teal; **Continue** is pressed. "No account needed." appears beside it.
- The staff side: the **Pending requests** row ("Ana Cruz · Oral prophylaxis · Dr. Reyes · Oct 15, 10:00 AM") arrives with the Requests badge ticking 1→2; a cursor picks **Chair 1** and presses **Confirm request**; the badge flips from Pending (amber) to Scheduled (blue) and the email line "Appointment confirmed: Oct 15, 2026, 10:00 AM" slides in.
- The schedule grid (Figure 3.7): Dr. Reyes / Dr. Lim columns, the Maria Santos "ATTENDED" block and the Jose Ramos "NO-SHOW" block in place, then the new Scheduled block drops into the 10:00 row. Open-time chips sit beside it.
- The reports strip (Figure 3.10): four stat cards count up — Attended **30**, Cancelled **3**, No-show **5**, No-show rate **14.3%** — then the by-dentist rows "Dr. Reyes 10.0%" and "Dr. Lim 20.0%".

## Outro / punchline
Tooth mark, "G4 Dental Clinic", then the tagline taken from the form header: **"Request an appointment online."** Small line under it: "Confirmation and day-before reminder emails, sent automatically." (That phrase is in the product: "Sent automatically the day before".) Hold.

## User flow worth showing
1. **Entry:** patient on a phone opens `/book`, picks a date, taps an open time, taps Continue.
2. **Key action:** staff open the pending request, pick a chair, click **Confirm request**.
3. **Result:** the block lands on the schedule grid and the month's report updates; the confirmation email subject appears.

## Tone
- Preset: app-store
- Creative direction: a calm clinical product film: the logbook is closed, the schedule is open
- Interpretation: clean slides and wipes, title-case feature labels, medium weight, every scene one screen of the real app with one simulated interaction. No jokes at the clinic's expense. Confidence through things working.

## Format: landscape — 1920x1080
## Duration: 21 seconds

## Visual identity (from the project)
- Background: #f6f8f9 (canvas) with #ffffff cards, 1px #e2e8f0 borders, 12px radius
- Accent: #0f766e (brand-700) for fills/buttons; #0d9488 (brand-600) hover; #ccfbf1 / #f0fdfa tints for chips
- Text: #0f172a (slate-900) primary, #475569 (slate-600) secondary
- Status colors from the UI: Pending amber (#fef3c7 bg / #92400e text), Scheduled blue (#dbeafe / #1e40af), Attended green (#dcfce7 / #166534), No-show red (#dc2626 fill, white text)
- Display font: Inter (semibold for headings)
- Body font: Inter
- Strongest visual element: the open-time chip grid turning teal on tap (phone), and the day grid with colored status blocks (desktop). Logo: white tooth glyph in a teal rounded square (SVG path in the project).

## Share copy (draft)
Small dental clinics still book on paper. We built a web app where patients request a visit online, staff confirm it onto a schedule that refuses double bookings, and the no-show report writes itself.

## Audio direction
- Role: warm bed with a consistent light SFX layer
- Music: happy-beats-business-moves-vol-11-by-ende-dot-app.mp3 (warm, business-y; 114.84 BPM)
- Music treatment: start at 0 at ~0.32, hold through, fade out over the last 1.5 s under the outro
- Music cue guidance: preset read from the bundled cues. Strong cues to target: **3.70 s** (hook line 2 / cut to phone), **9.50 s** (Confirm request click), **12.65 s** (block lands on the schedule grid), **17.91 s** (outro logo). Beat grid for the stat cards: 14.22, 14.76, 15.28, 15.81 (every beat is fine: numbers, not sentences, and they hold on screen after).
- Audio-reactive treatment: subtle; let the teal logo mark and the card shadows breathe with RMS. No waveform/equalizer visuals.
- SFX posture: moderate, motion-matched, low HF risk: clicks for taps/cursor, soft drops for cards, one bell on Confirm, one soft impact on the logo
- Audio-coupled moments: slot chip tap, Continue press, requests badge tick, chair pick, Confirm click (bell), schedule block drop, four stat counters, outro logo
- Restraint rule: no stacked hits, nothing above 0.8, no sound on text that just fades in

## Storyboard

### Scene 1 — Hook — 3.7s
Canvas #f6f8f9. Teal tooth mark + "G4 Dental Clinic" (small, top-left, like the app's top bar) fade in at 0.3 s. Center, large Inter semibold: "Small dental clinics still book on paper." arrives at 0.9 s and holds. At 3.0 s a second line snaps in below in teal: "Not this one." Scene ends on the 3.70 s cue.
Sequential/interaction: yes: two lines, second snaps on the beat
Audio intent: quiet confidence, the bed just starting
Audio-coupled idea: "Not this one." lands on the 3.70 s strong cue with a soft drop
Music: warm bed from 0
Transition mood: clean slide (phone frame slides up) → Scene 2

### Scene 2 — Patient books on a phone — 5.3s (3.7–9.0)
A phone frame (390 wide) centered-left shows the real `/book` step 2: header "G4 Dental Clinic / Request an appointment online", the three-step progress (Visit · Date & time · Your details), "Pick a date and time", "Tooth filling · Dr. Reyes", the October 2026 calendar with 14 selected, then "Open times on Oct 14, 2026" with the chip grid (9:00 AM … 4:00 PM). At 5.3 s a tap ring lands on **10:00 AM**; the chip fills teal. At 6.9 s the tap hits **Continue**. Right of the phone, two labels appear one after the other (each holds ≥1.2 s): "Online request form" (title-case feature label) at 4.3 s, then "No account needed." at 6.3 s, then "Open times only. Taken slots never show." at 7.4 s.
Sequential/interaction: yes: simulated tap on the 10:00 AM chip, then on Continue; three labels in sequence
Audio intent: light, tactile
Audio-coupled idea: click on each tap; soft drop on each label
Music: bed continues
Transition mood: clean wipe to desktop → Scene 3

### Scene 3 — Staff confirm it — 4.0s (9.0–13.0)
Desktop frame: the real appointment detail page. Left card "Visit": Date Thursday, Oct 15, 2026 · Time 10:00 AM – 10:30 AM · Service Oral prophylaxis (30 min) · Dentist Dr. Reyes · Chair "Not assigned yet". Header "Appointment #40" with the amber **Pending** badge and "Online" channel badge. Right card "Review request / Pick a free chair, then confirm. Confirming emails the patient." with Chair 1 / Chair 2 buttons and the **Confirm request** button. A cursor clicks **Chair 1** at 9.5 s (beat-locked 9.50), then **Confirm request** at 10.5 s; the badge flips to blue **Scheduled**, Chair reads "Chair 1", and a slim email line slides in at the bottom: "✉ Appointment confirmed: Oct 15, 2026, 10:00 AM". Side label: "Confirm or decline from one queue."
Sequential/interaction: yes: cursor clicks chair, then confirm; badge flip; email line slides in
Audio intent: the satisfying click of a decision
Audio-coupled idea: click on chair, bell on Confirm (success), soft drop on the email line
Music: bed continues
Transition mood: clean slide → Scene 4

### Scene 4 — It lands on the schedule — 3.5s (13.0–16.5)
Desktop frame: the real dashboard day grid for Monday, Oct 12, 2026 restyled as Oct 15: columns Dr. Reyes (9:00 AM – 5:00 PM) and Dr. Lim; time rows 9:00 AM–11:30 AM visible; the Maria Santos "ATTENDED" green block at 9:00 and the Jose Ramos "NO-SHOW" red block at 9:30 already in place. At 13.2 s the new blue **Scheduled** block "Ana Cruz · 10:00 AM · Oral prophylaxis" drops into Dr. Reyes 10:00 (beat-locked to 12.65 → shifted to the scene start at 13.0–13.2, within tolerance of the 13.18 beat). Right panel "Open times" with teal chips. Side label: "One schedule, every channel." then a second: "Double bookings are refused on save."
Sequential/interaction: yes: block drops in; two labels in sequence
Audio intent: things clicking into place
Audio-coupled idea: soft impact on the block landing
Music: bed continues
Transition mood: clean slide → Scene 5

### Scene 5 — The report writes itself — 3.5s (16.5–20.0)
Desktop frame: Reports, October 2026. Four stat cards arrive one by one and count up: **Attended 30** (green), **Cancelled 3** ("Excludes reschedules"), **No-show 5** (red), **No-show rate 14.3%** with the small amber bar. Then the By dentist rows fade in: Dr. Reyes 18 · 2 · 2 · 10.0%, Dr. Lim 12 · 1 · 3 · 20.0%. Side label: "Attendance and no-shows, computed on every open."
Sequential/interaction: yes: four cards on consecutive beats (16.86, 17.39, 17.91, 18.44) with counters; rows after
Audio intent: tidy, counted
Audio-coupled idea: soft drop per card; tiny chip-lay on the rate card
Music: bed continues, starts fading at 19.5
Transition mood: soft crossfade → Scene 6

### Scene 6 — Outro — 1.0s + hold to 21.0 (20.0–21.0)
Canvas. Teal tooth mark scales in (beat-locked near 20.02), "G4 Dental Clinic" beside it, tagline "Request an appointment online." below, and the small line "Confirmation and day-before reminder emails, sent automatically." Hold to the end.
Sequential/interaction: logo, then two lines
Audio intent: a clean close
Audio-coupled idea: one soft impact on the logo; music fades out under it
Music: fade to silence by 21.0
Transition mood: end

**Music mood for this video:** upbeat but warm (vol-11)
**Audio summary:** a warm bed from frame one, light clicks and drops that follow the taps and card arrivals, one bell on Confirm as the only big accent, soft impact on the final logo, music fading under the outro.

## Privacy note
All names, numbers and emails on screen are the project's own seed/demo data (Maria Santos, Jose Ramos, Ana Cruz, 0917 123 4567, example.com addresses). No real patient data exists in this project. The demo banner text is omitted from the video frames for cleanliness; everything else is verbatim UI.
