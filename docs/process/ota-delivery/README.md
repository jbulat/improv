# How over-the-air delivery was built

These are the working documents for one feature: over-the-air story delivery, called "device
track part 3" at the time. They are kept as they were written, with a few redactions (listed at
the end). They are evidence of the build loop, not polished documentation.

## The loop, in these files

1. **Design**, 2026-07-20. What to build and why, the protocol, the milestones and the success
   criteria. Its status line was updated as the work finished.
2. **Plan**, from 2026-07-23. Twelve tasks, each written test-first with exact steps, built one
   at a time. Tasks 7, 9 and 12 are hardware checkpoints on the StickS3, and their results are
   written into the plan under each task.
3. **Reviews.** The code was reviewed by the agent that wrote it, then by a separate review agent
   (spec, quality and security), then by Jarrett on the pull request. The review notes themselves
   were not kept; the plan records only their outcomes where they mattered.
4. **Hardware sessions.** The results under Tasks 7, 9 and 12.

| File | What it is |
|---|---|
| [`2026-07-20-device-track-part3-courier-story-delivery-design.md`](2026-07-20-device-track-part3-courier-story-delivery-design.md) | The design |
| [`2026-07-23-device-track-part3-ota-story-delivery.md`](2026-07-23-device-track-part3-ota-story-delivery.md) | The plan, with the hardware-session results |

## The moment to read

In the plan, under **Task 7** (the first hardware checkpoint, M0), find the paragraph that starts
"M0 was blocked for a full session". The fetch state machine never ran on a device with no app
loaded, because the runtime only ticks extensions while an app is loaded. The agents' code reviews
had all passed the code. The first hardware session found the bug, and the fix is described in
the same paragraph.

A few paragraphs later, the plan also records a reviewer's "Minor" finding that the hardware
session then confirmed: a failed request blocks the device's main loop. It is still open, and
is listed in [Known limits of delivery](../../../WORKFLOWS.md#known-limits-of-delivery).

## Reading notes

- **`story-director`** is the old name of the `story-create` skill.
- **`lighthouse-and-fog`** was an early test story. It was later removed.
- **"PR #22"** and the commit hashes refer to the private working repository, so they do not
  resolve here.
- **"The README"** means the README of that time, not this repository's current README.
- File paths are as they were then. Some files were later renamed or merged.

## Redactions

A few lines were changed to remove private details, and one link to a file that is not in this repository was removed. Nothing else was edited.

| What | Replaced with |
|---|---|
| The id of the one StickS3 the prototype ran on | `<device-id>` |
| Local network addresses | `<lan-ip>`, `<mac-lan-ip>`, `<device-lan-ip>` |
| A path on the developer's computer | `<repo root>` |
