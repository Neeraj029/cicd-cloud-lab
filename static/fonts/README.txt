BUNDLED FONT
============
  InterVariable-latin.woff2   (48 KB, variable weight 100-900, latin subset)

Inter is the standard open-source stand-in for Apple's SF Pro. It is committed
to the repo so the UI renders identically on every machine and needs no
internet - which matters when the app is served from Minikube and you are
screenshotting for the submission.

CSS stack: -apple-system, "SF Pro Text", "Inter Variable", Inter, Helvetica,
Arial. macOS uses real SF Pro when installed; everything else uses Inter.

Re-fetch / update with:
  Invoke-WebRequest "https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@latest/files/inter-latin-wght-normal.woff2" -OutFile static/fonts/InterVariable-latin.woff2

Delete this file's font and the app still runs: it falls back to system
Helvetica / Arial.