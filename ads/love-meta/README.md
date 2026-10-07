# Love night ads (Meta)

Coded animations for six love. Meta ads, all set at night: a starry plum sky,
a moon, and a street of houses whose windows switch on one by one. Each ad
runs 10 seconds at 30 fps. Everything has landed by about 5.5 seconds, and the
rest holds with a slow push-in, drifting haze and a light sweep across the
headline, so the ad still works if it gets cut short.

The last frame is the complete ad, so each one also ships as a still for
image placements.

| Ad | Hero animation | On-screen copy | CTA |
|---|---|---|---|
| `fees` | A dollar reel spins and lands on $0 with a gold ring | Pay zero management fees / Conditions apply. / See how love. property management works | Learn more |
| `chat-2287` | A chat bubble types, then 2287 flickers on like a lit house number | 2287 homeowners, let's chat / No-obligation appraisal. No pressure to list. | Get quote |
| `price-2287` | Headline rises, then a house pin slides along a scale and settles | 2287 homeowners / Would the right price change your mind? / Find out where your 2287 home sits | Get quote |
| `chat-2284` | Same as `chat-2287` | 2284 homeowners, let's chat | Get quote |
| `price-2284` | Same as `price-2287` | Find out where your 2284 home sits | Get quote |
| `offer` | An envelope with a love. heart seal opens and an offer card rises out | You might not be planning to sell. / Would the right offer change your mind? / No-obligation appraisal. See where you sit. | Get quote |

The offer card shows no figure on purpose: a blank gold bar sits where an
amount would go.

## Formats

| `fmt` | Size | Placement |
|---|---|---|
| `story` | 1080x1920 (9:16) | Stories and Reels. Copy stays out of the top 250 px and bottom 380 px, where Meta's UI sits. |
| `feed` | 1080x1350 (4:5) | Feed |

## Files

```
renders/<ad>-story.mp4        9:16 video
renders/<ad>-feed.mp4         4:5 video
renders/stills/<ad>-<fmt>.png still image ad (last frame)
```

## Preview and render

Open `ad.html` in a browser. The buttons at the top switch ad and format.
`?ad=offer&fmt=feed&t=3` freezes on one moment.

```bash
node ads/love-meta/render.mjs                    # all six, both formats
node ads/love-meta/render.mjs fees offer         # just these
node ads/love-meta/render.mjs --fmt story        # 9:16 only
node ads/love-meta/render.mjs --stills           # PNG end frames only
```

Needs Node with Playwright and ffmpeg. The videos are silent. Most Meta
placements autoplay muted, and a sound bed can be added later.

## Changing things

- New postcode: add `ADS["chat-2290"] = chat("2290")` or `price("2290")` near
  the bottom of `ad.html`, and add the name to `ALL` in `render.mjs`.
- Logo: `logos/love.png` (white wordmark, plum dot). `?logo=path.png`
  swaps it for a preview.
- Fonts: Gloock for headlines, Montserrat standing in for Proxima Nova, the
  same setup as `outros/knights/`. Drop the Proxima Nova files into
  `assets/fonts/` and they take over.

## Before these go live

- `fees`: confirm the zero management fees offer is still current, and that
  "Conditions apply." on screen is enough for whoever signs off the terms.
