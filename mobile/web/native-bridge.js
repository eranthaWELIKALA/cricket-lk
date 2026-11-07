/* Cricket.lk — Android bridge. Guest edition only: scripts/build-web.mjs copies
   it into www/js/ and loads it before the app's own scripts. Never part of the
   website.

   Android's WebView lacks a few web APIs the app relies on. Rather than
   change the app, this fills them in with native calls (CricketNativePlugin
   in android/app/src/main/java/…), so the app's code paths stay the same as
   on the web:
   - navigator.share / navigator.canShare, with image files → the Android
     share sheet (the share preview's "Share": WhatsApp, Drive, …);
   - <a download> of a blob or data URL → saved to Pictures/Cricket.lk (the
     share preview's "Save image");
   - window.print() → Android's print dialog, which has "Save as PDF"
     (Export PDF: it prints the page as it is, with the @media print rules);
   - the status and navigation bar icons follow the theme: light on a dark
     theme, dark on a light one (applyTheme keeps meta theme-color in step).
   Opened outside the app (a desktop browser, for debugging) it does nothing. */
(function(){
  "use strict";
  var cap = window.Capacitor;
  if (!cap || typeof cap.nativePromise !== "function" || !cap.isNativePlatform || !cap.isNativePlatform()) return;

  function callNative(method, options){ return cap.nativePromise("CricketNative", method, options || {}); }

  // The app is served from the APK, so a service worker has nothing to cache
  // (www/ has no sw.js): hide the API and boot.js doesn't try to register one.
  try { delete Navigator.prototype.serviceWorker; } catch (_){}

  function blobToBase64(blob){
    return new Promise(function(resolve, reject){
      var r = new FileReader();
      r.onload = function(){ resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function(){ reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function isImage(f){ return !!f && /^image\/(png|jpeg|webp)$/.test(f.type || ""); }

  // --- Web Share ---------------------------------------------------------
  Object.defineProperty(navigator, "canShare", {
    configurable: true, writable: true,
    value: function(data){
      if (!data) return false;
      var files = data.files ? Array.prototype.slice.call(data.files) : [];
      if (files.length) return files.every(isImage);
      return !!(data.text || data.url || data.title);
    }
  });
  Object.defineProperty(navigator, "share", {
    configurable: true, writable: true,
    value: function(data){
      data = data || {};
      var files = data.files ? Array.prototype.slice.call(data.files) : [];
      if (!navigator.canShare(data)) return Promise.reject(new DOMException("Nothing this app can share", "NotAllowedError"));
      var text = [data.text, data.url].filter(Boolean).join("\n");
      var opts = { text: text, title: data.title || "" };
      if (!files.length) return callNative("share", opts).then(function(){});
      var f = files[0];
      return blobToBase64(f).then(function(b64){
        opts.data = b64; opts.fileName = f.name || "image.png"; opts.mimeType = f.type;
        return callNative("share", opts);
      }).then(function(){});
    }
  });

  // --- <a download> → save the image -------------------------------------
  var anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){
    var href = this.href || "";
    if (this.hasAttribute("download") && /^(blob|data):/.test(href)){
      var name = this.getAttribute("download") || "image.png";
      fetch(href)
        .then(function(res){ return res.blob(); })
        .then(function(blob){
          return blobToBase64(blob).then(function(b64){
            return callNative("saveImage", { data: b64, fileName: name, mimeType: blob.type || "image/png" });
          });
        })
        .catch(function(err){ console.error("Cricket.lk: saving the image failed", err); });
      return;
    }
    return anchorClick.call(this);
  };

  // --- window.print() → Android's print dialog ----------------------------
  // exportPdf sets document.title (the PDF's name) right before calling this.
  window.print = function(){
    callNative("print", { name: document.title || "Cricket.lk" })
      .catch(function(err){ console.error("Cricket.lk: printing failed", err); });
  };

  // --- system bar icons follow the theme -----------------------------------
  var barStyle = null;
  function hexToRgb(c){
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || "").trim());
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return [0, 2, 4].map(function(i){ return parseInt(h.slice(i, i + 2), 16); });
  }
  function syncBars(){
    var meta = document.querySelector('meta[name="theme-color"]');
    var rgb = hexToRgb(meta && meta.content);
    if (!rgb) return;
    var luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    var style = luminance > 0.6 ? "LIGHT" : "DARK";   // LIGHT = dark icons on a light bar
    if (style === barStyle) return;
    barStyle = style;
    cap.nativePromise("SystemBars", "setStyle", { style: style }).catch(function(){});
  }
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) new MutationObserver(syncBars).observe(themeMeta, { attributes: true, attributeFilter: ["content"] });
  document.addEventListener("DOMContentLoaded", syncBars);
  syncBars();
})();
