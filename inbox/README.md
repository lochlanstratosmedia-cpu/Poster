# Inbox

Drop property photos here. Any filename, any number, JPG, PNG or iPhone HEIC.

Then tell Claude "run the inbox" (or `/cover-shot`). Each photo moves into its
own `covers/<name>/` folder and goes through the full cover-shot process.

Words in a filename set options, so you can skip typing them later:

- shot: `exterior`, `interior`, `kitchen`, `bathroom`, `living`, `bedroom`, `garden`, `detail`
- light: `golden`, `soft`, `morning`, `dusk`
- post: `just-listed`, `coming-soon`, `just-sold`, `for-lease`, `open-home`
- source: `phone` or `camera` (otherwise read from the photo's camera data)

Example: `kitchen golden just-listed.jpg`.

Photos in this folder are gitignored so they are never committed from a local
clone. The repo is public, so don't upload them here through the GitHub
website: anything added that way is published.
