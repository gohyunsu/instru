# Score library

Keep public MuseScore files here as lowercase, hyphenated English filenames, such as `danny-boy.mscz`. The generated `index.json` lists the scores intended for the site. The public build copies only those listed files, so an unrelated local file is not published by accident.

After adding or renaming a score, stage the file and run `npm run scores:index` to refresh the manifest. Only commit scores you may publish.
