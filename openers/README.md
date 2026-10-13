# Reel openers

Animated intros for property reels. Open `opener.html` in Chrome, Edge or
Safari, add a photo or clip, type the search, and press Save video.

## Styles

| Style | What happens |
|---|---|
| Search bar | A white circle pops in over the photo, a magnifier draws inside it, the circle stretches into a search bar, the search types out with a caret, the bar is tapped, then it fades up or zooms through |
| Notification | A notification banner drops in over the blurred photo with a ding, with the photo as its thumbnail. It presses in and the photo grows from the thumbnail to full screen |
| Messages | A phone chat screen with the contact at the top and a message field at the bottom. Typing dots, then bubbles pop up one at a time and push the older ones up. The last message is the photo, which presses in and grows to full screen |
| Saved listing | A listing card slides up with the photo, title and bed, bath and car numbers. The heart fills red with a pop and sends small hearts up, then "Saved to favourites" shows |
| Open home | A calendar card drops in and bounces with the day, date, time and place. A green tick draws on its corner and "Added to calendar" shows |

New styles go in `STYLES` inside `opener.html`. Each one has a `plan()` that
returns its timeline and sound cues, and a `draw()` that paints one frame.
Add a button for it in the `#style` group.

The four phone styles start with the photo blurred and darkened, and it
sharpens as the card leaves. Zoom through grows the photo out of the card
(or, for Open home, flies through the card). Untick "Blur the photo until the
reveal" to keep it sharp the whole time.

Messages has its own chat screen in light or dark, so the photo only shows in
the photo bubble and the reveal. Add a contact name for initials in the
avatar, or leave it blank for a plain one. Pick "Blurred photo" to use the
photo behind the chat like the other styles. With Green screen or
Transparent, only the bubbles show.

With a video clip loaded, Notification, Messages and Saved listing show the
clip's first frame with a play badge. When it is pressed it grows to full
screen and plays from the start, and the saved video carries on to the end of
the clip with the clip's own sound. Untick "Play the whole clip after the
opener" to stop at the opener, or "Keep the clip's own sound" to keep only the
effects. Behind the search bar the clip plays from the first second.

The listing card hides any bed, bath or car number left blank. The open home
day, date and time start as examples, so set them to the real open home
before saving.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Search text | Homes for Sale in Nords Wharf, NSW | Long searches shrink to fit the bar |
| Typing speed | 14 keys/s | Each key gets a small random gap so it reads as a person typing |
| Hold after typing | 1.2 s | Time on the finished search before the tap |
| Format | 9:16 Reel | 4:5 for feed posts |
| Height on screen | 30% | Where the bar sits, from the top |
| Ending | Fade up | Zoom through, or stay on screen to cut away in the edit |
| Clip after the bar leaves | 0.6 s | Background keeps rolling before the opener ends |
| Background | Photo or clip | Green screen gives a flat #00b140 for keying in CapCut. Transparent saves a WebM with an alpha channel |
| Slow push-in | On | 8% zoom over the length of the opener |
| Sound effects | On | Pop, whoosh, key clicks and a tap, made from noise and sine waves, so there is nothing to license |

Settings stay in the browser between visits.

## Saving

Save video builds the file frame by frame, so nothing drops and the tab can
sit in the background. It takes longer than the opener runs, more so with a
long clip, because the clip is stepped through one frame at a time.

| File | What it is | Use it for |
|---|---|---|
| MP4 for posting | H.264 video with AAC sound, built with WebCodecs and [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | Instagram, TikTok, CapCut, anything |
| MOV with transparency | QuickTime with one PNG per frame (alpha kept) and 16-bit PCM sound | Premiere, Final Cut, DaVinci Resolve, After Effects |

A transparent background always saves as MOV, since MP4 has no alpha channel.
The MOV is large (about 30 MB for 8 seconds of the Messages opener) because
every frame is lossless. Saved from the claude.ai page it comes inside a
`.zip`, because the page cannot save `.mov` files directly; opened from this
repo it saves the `.mov` itself.

Desktop Chrome, Edge and Safari can all build the MP4. A browser with no
H.264 encoder records the MP4 in real time if it can, and builds the MOV if it
cannot.

For true ProRes 4444, use `render.mjs --alpha`.

## Frame-exact renders

`render.mjs` steps through every frame in headless Chromium and encodes with
ffmpeg, so nothing drops.

```bash
node openers/render.mjs --photo house.jpg --text "Homes for Sale in Nords Wharf, NSW"
node openers/render.mjs --clip drone.mp4 --text "..."    # bar over a video clip
node openers/render.mjs --style messages --ending zoom --clip walkthrough.mp4   # opener, then the whole clip
node openers/render.mjs --alpha --text "..."             # transparent .mov and .webm
node openers/render.mjs --photo house.jpg --ending zoom --fmt 4x5 --cps 18
```

Every page setting works as a flag: `--fmt --pos --width --size --cps --hold
--ending --tail --tap 0 --push 0 --sound 0`. Output goes to `openers/renders/`
as MP4 with sound, plus the effects on their own as `.sfx.wav`.

`--alpha` writes a ProRes 4444 `.mov` and a VP9 `.webm`, both with
transparency, for laying over footage in an editor. `--clip` composites the bar
over the clip with ffmpeg, because Playwright's Chromium cannot decode H.264 or
HEVC. The push-in applies to photos only. Convert HEIC photos to JPG first.

Needs Node with Playwright and ffmpeg, the same as `outros/knights`.
