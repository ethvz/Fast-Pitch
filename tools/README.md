# Art-board bake

`bake.py` merges Fast Pitch art-board edits (the artifact's `layout` db collection) into the
`<script id="lyBakedData">` block of `index.html`. The page applies that block on every load, so
baked edits show on GitHub Pages, offline iPads and claude.ai alike.

Run by the "Fast Pitch – publish art-board edits" scheduled task, fired from the Publish button in
Edit layout mode. Anyone editing index.html by hand must keep the lyBakedData block from GitHub.
