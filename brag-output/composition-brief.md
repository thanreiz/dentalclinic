# Hyperframes Composition Brief: G4 Dental Clinic

## Objective
Create a short launch-style brag video for the G4 Dental Clinic appointment system (a PLM BSCS thesis build: online booking, staff confirmation, double-booking-safe schedule, no-show reports).

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21.5 seconds

## Source Material
- Project root: the `dentalclinic` repo (Next.js 15 + Tailwind; pages in `app/`, components in `components/ui`, tokens in `app/globals.css`)
- Primary files read: `app/globals.css`, `app/book/*`, `app/(staff)/*`, `components/ui/Badges.tsx`, `components/ui/icons.tsx` (tooth mark), `docs/screenshots/appendix-b/*.png`, `docs/PRD.md`
- Product name: G4 Dental Clinic
- Tagline / strongest claim: "Request an appointment online" (form header); "No account needed. Your request is reviewed by clinic staff before it is confirmed."
- Key UI or visual moments to recreate: the phone booking form's open-time chip grid turning teal on tap; the appointment detail "Review request" card with Chair 1 / Chair 2 and **Confirm request**; the day schedule grid with colored status blocks; the Reports stat cards (Attended 30 · Cancelled 3 · No-show 5 · No-show rate 14.3%).
- Copy that must appear verbatim:
  - Request an appointment online
  - No account needed.
  - Pick a date and time
  - Open times on Oct 14, 2026
  - Confirm request / Decline request / Chair (free at that time)
  - Confirming emails the patient.
  - Appointment confirmed: Oct 14, 2026, 10:00 AM
  - Attended / Cancelled / No-show / No-show rate · Excludes reschedules
  - Dr. Reyes 18 · 2 · 2 · 10.0% / Dr. Lim 12 · 1 · 3 · 20.0% / Total 30 · 3 · 5 · 14.3%
  - Computed from recorded appointments each time you open this page.

## Creative Direction
- Tone preset: app-store
- Creative direction: a calm clinical product film: the logbook is closed, the schedule is open
- Interpretation: clean slides, title-case feature labels, Inter 700/400 (the product's own face), every scene one screen of the real app with one simulated interaction; confidence through things working, no jokes at the clinic's expense.
- Angle: small clinics still book on paper; this one lets a patient tap a slot on a phone, staff click Confirm, and the schedule and the monthly report fill themselves in. Nothing is claimed that the UI does not already say.
- Hook: "Small dental clinics still book on paper." then, in teal, "Not this one." → push up into the phone form.
- Outro / punchline: tooth mark + "G4 Dental Clinic" + "Request an appointment online." + "Confirmation and reminder emails, sent automatically."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign (keep the product's white cards / teal accent / status colors)

## Visual Identity
- Background: #f6f8f9 canvas, #ffffff cards, borders #e2e8f0 (2px at video scale)
- Text: #0f172a primary, #475569 secondary
- Accent: #0f766e (brand-700) fills, #0d9488 hover, #ccfbf1 / #f0fdfa tints
- Status: pending amber (#fef3c7 / #78350f), scheduled blue (#dbeafe / #1e40af), attended green (#dcfce7 / #166534), no-show red (#dc2626 fill, white text)
- Display font: Inter 700 (bundled)
- Body font: Inter 400 (bundled)
- Visual references from the project: tooth glyph in a teal rounded square; 3-step progress bar (Visit · Date & time · Your details); calendar with teal selected day; chip grid; status badges with dots; stat cards with a small rate bar.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract (times adjusted to the music's beat grid).

Scene summary:
1. Hook — 0.0–4.23 s — brand lockup top-left; "Small dental clinics still book on paper." (0.5 s); "Not this one." in teal lands on the 2.65 s beat; ruled-paper decor fades as the line lands.
2. Patient books on a phone — 4.23–9.0 s — phone frame with the real step-2 form; tap on **10:00 AM** at 5.80 s (strong cue), tap on **Continue** at 6.86 s; side labels "Online request form", "No account needed.", "Only open times are shown."
3. Staff confirm it — 9.0–13.0 s — appointment detail frame; cursor clicks **Chair 1** at 9.50 s (strong cue), **Confirm request** at 10.54 s; badge flips Pending → Scheduled; email line slides in at 11.06 s; labels "Staff confirm it", "Confirming emails the patient."
4. It lands on the schedule — 13.0–16.5 s — day grid Wednesday, Oct 14, 2026, Dr. Reyes / Dr. Lim columns; the blue Scheduled block "Ana Cruz · 10:00 AM · Tooth filling" drops in at 13.18 s; Open times panel; labels "One schedule, every channel." and "Overlapping bookings are rejected on save."
5. The report writes itself — 16.5–19.6 s — four stat cards on consecutive beats (16.86, 17.39, 17.91, 18.44) counting up; By dentist rows at 18.96 s; label "Computed from recorded appointments each time you open this page."
6. Outro — 19.6–21.5 s — crossfade; tooth mark scales in on the 20.02 s beat, name, tagline, small line; hold.

## Audio
- Audio role: warm bed with a consistent light SFX layer
- Audio arc: bed from frame one; clicks/drops follow taps and card arrivals; one bell on Confirm as the only big accent; soft impact on the schedule block and the final logo; music fades out under the outro.
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`
- Music treatment: 0.32 from 0 s, hold, fade to 0 over 20.0–21.5 s via a `data-automation` volume lane.
- Music cue guidance: bundled preset `cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json` (114.84 BPM). Strong cues used: 5.80 (slot tap), 9.50 (chair click), 17.91 (third stat card). Beat grid used: 2.65, 4.23, 6.86, 10.54, 11.06, 13.18, 16.86, 17.39, 18.44, 18.96, 20.02.
- Audio-reactive treatment: subtle; per-frame RMS from `assets/audio-data.json` (extracted with the hyperframes-creative script) drives a CSS variable that breathes the background teal glow and the outro mark's soft shadow. No waveform/equalizer visuals.
- Audio-coupled moments:
  - S1 "Not this one." — soft drop on the beat
  - S2 chip tap / Continue — clicks; labels — soft drops
  - S3 Chair 1 click — click; Confirm — bell; email line — drop
  - S4 block landing — soft impact
  - S5 stat cards — drops on consecutive beats, chip-lay on the rate card
  - S6 logo — soft impact; music fade
- SFX selection guidance: low HF-risk picks from `sfx-analysis.md` (`interface/click_002/003`, `interface/drop_001/002`, `impact/impactSoft_medium_001/004`, `impact/impactBell_heavy_000` once, `casino/chip-lay-1` once). Volumes 0.5–0.8.
- SFX analysis guidance: `<brag skill>/assets/sfx/sfx-analysis.md`
- Exact SFX choice: chosen after the animation was timed (see the `<audio>` list in `index.html`).
- Audio files: copied into `brag-output/composition/assets/`

## Hyperframes Instructions
Domain skills loaded: hyperframes-core, hyperframes-animation (transitions/css-push, gsap adapter), hyperframes-creative (house-style, video-composition, audio-reactive), hyperframes-keyframes, hyperframes-cli. Monolithic single `index.html`, root-level clips overlapping by the transition length, push-slide / vertical-push transitions, one paused GSAP timeline keyed `main`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet.
- Major reveals may move toward nearby strong cues within about 0.15s; smaller entrances within about 0.10s of a beat.
- Run `hyperframes check` before render — it is brag's single gate.
- Keep creation and rendering local.
