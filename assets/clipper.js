/* Recording what happened, not what one frame of it looked like.

   A still of an augment screen says a screen was open. It does not say which
   card the cursor went to, whether they hovered two and changed their mind, or
   what the shop looked like a second before it emptied. Every question a
   gamemaster actually has is about a few seconds, not an instant.

   So this keeps a rolling buffer of the last few seconds at all times, and when
   a finding fires it saves from before the moment to after it. The lead-up is
   the part that matters and it has already happened by the time anything is
   detected — which is the whole reason for recording continuously rather than
   starting when something is spotted.

   MediaRecorder does the encoding, so nothing here touches pixels. It runs on
   the same getDisplayMedia stream the detector already reads, at a low bitrate
   because these are evidence clips rather than highlights. Measured on a
   960x540 stream at 600kbps: an eight-second clip is 97KB and about 133,000
   characters once base64ed, against an endpoint that allows 1.4 million. Eight
   of them in a game is under a megabyte, which is what makes sending every one
   practical rather than picking which findings deserve video.

   Nothing is uploaded continuously. The buffer lives in this tab and is thrown
   away as it ages; only the seconds around a finding are ever sent. */

(function (root) {
  'use strict';

  /* One wart worth knowing about: a webm written by MediaRecorder has no
     duration in its header, because when the header was written nothing knew
     how long the recording would be. Players report Infinity and will not
     scrub until they have been made to walk the file. The dashboard does that
     — see fixClipDurations in session.js. Rewriting the header properly needs
     an EBML library and is not worth it for an eight-second clip. */
  const MIME = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of MIME) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* older browsers */ }
    }
    return null;
  }

  /**
   * createClipper(stream, opts)
   *   before  seconds of lead-up to keep      (default 6)
   *   after   seconds to keep recording after (default 4)
   *   bps     video bitrate                   (default 800k)
   */
  function createClipper(stream, opts) {
    const cfg = Object.assign({ before: 6, after: 4, bps: 800000 }, opts || {});
    const mime = pickMime();
    if (!mime) return null;

    /* One-second slices, so the buffer can be trimmed to whole chunks and a
       clip always starts on a keyframe-ish boundary. */
    const SLICE_MS = 1000;
    const keep = Math.ceil(cfg.before) + 2;

    let rec = null;
    let chunks = [];
    let header = null;      // the very first chunk, kept forever — see below
    let stopped = false;

    function start() {
      try {
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: cfg.bps });
      } catch (e) {
        try { rec = new MediaRecorder(stream); } catch (e2) { return false; }
      }
      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;

        /* The first chunk is not like the others. MediaRecorder puts the EBML
           header and the initialisation segment in it, and everything after is
           media clusters that mean nothing on their own. Keep it forever and
           put it in front of every clip.

           Without this the rolling buffer eventually evicts it and every clip
           taken after that is a pile of clusters with no header. They store
           fine, they serve fine, they are the right size and the right content
           type, and no player will touch them — a real run produced one clip
           that played and three that failed with SRC_NOT_SUPPORTED. */
        if (!header) { header = e.data; return; }

        chunks.push({ at: Date.now(), blob: e.data });
        const cutoff = Date.now() - keep * 1000;
        while (chunks.length > 2 && chunks[0].at < cutoff) chunks.shift();
      };
      rec.start(SLICE_MS);
      return true;
    }

    /* Grab the buffered lead-up, then keep collecting for `after` seconds and
       hand back one blob. The recorder is never stopped, so the buffer keeps
       filling for the next finding. */
    function clip() {
      if (!rec || stopped) return Promise.resolve(null);
      const lead = chunks.slice();
      return new Promise((resolve) => {
        const seen = [];
        const grab = (e) => { if (e.data && e.data.size) seen.push(e.data); };
        rec.addEventListener('dataavailable', grab);
        setTimeout(() => {
          rec.removeEventListener('dataavailable', grab);
          const parts = lead.map((c) => c.blob).concat(seen);
          if (!parts.length) { resolve(null); return; }
          resolve(new Blob(header ? [header].concat(parts) : parts, { type: mime }));
        }, Math.round(cfg.after * 1000));
      });
    }

    function stop() {
      stopped = true;
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* already gone */ }
      chunks = [];
      header = null;
    }

    return {
      start: start,
      clip: clip,
      stop: stop,
      mime: mime,
      buffered: () => chunks.length,
      hasHeader: () => Boolean(header),
      seconds: () => (chunks.length ? Math.round((Date.now() - chunks[0].at) / 1000) : 0),
    };
  }

  root.TFTClipper = { createClipper: createClipper, pickMime: pickMime };
})(typeof window !== 'undefined' ? window : globalThis);
