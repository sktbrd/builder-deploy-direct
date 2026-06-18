# Vercel connect walkthrough screenshots

These images show up inside the **Connect Vercel** dialog (the popup that
appears when you click the "Connect Vercel" card).

Save the three screenshots with these exact names:

| File                              | What it shows                                                    |
| --------------------------------- | ---------------------------------------------------------------- |
| `step-1-add-integration.png`      | The integration page with the **Add Integration** button         |
| `step-2-select-team-install.png`  | The install dialog with the **team selector** / Install button    |
| `step-3-configure.png`            | The installation overview with the **Configure** button           |

Notes:

- These screenshots already have the red highlight box drawn in, so the code
  does **not** add an overlay (`VERCEL_GUIDE_STEPS` in `app/page.tsx` has no
  `highlight` field). If you swap in clean screenshots later, you can add a
  `highlight` with percent coordinates to draw the box in code instead.
- Images are shown at a 16:10 ratio with `object-cover`. Crop roughly to that
  shape so nothing important gets clipped.
- Until a file exists, the dialog shows a "Screenshot pending" placeholder in
  its slot — the rest of the flow still works.
