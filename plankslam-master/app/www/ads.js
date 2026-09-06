// AdMob integration for Plankslam (Capacitor / @capacitor-community/admob).
// Google's public TEST ad unit IDs are used below so the app is safe to build
// and test immediately. Before publishing, swap BANNER_ID and INTERSTITIAL_ID
// for the real ad unit IDs from your own admob.google.com console, and set
// isTesting / initializeForTesting to false.
window.Ads = (function () {
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const AdMob = NATIVE && window.Capacitor.Plugins ? window.Capacitor.Plugins.AdMob : null;

  const BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
  const INTERSTITIAL_ID = "ca-app-pub-3940256099942544/1033173712";
  const REWARDED_ID = "ca-app-pub-3940256099942544/5224354917";
  const FIGHTS_PER_INTERSTITIAL = 3;

  let ready = false;
  let interstitialReady = false;
  let fightCount = 0;

  // The banner is a native view laid over the bottom of the WebView, so the
  // page must reserve room for it or the last hub rows (ANSWER SURVEY / RESET
  // RUN) sit underneath and cannot be tapped. AdMob reports the adaptive
  // banner's real height in dp; mirror it into --ad-h and let CSS pad for it.
  function setAdHeight(px) {
    document.documentElement.style.setProperty("--ad-h", (px || 0) + "px");
  }

  async function init() {
    if (!AdMob) return;
    try {
      await AdMob.initialize({ initializeForTesting: true });
      ready = true;
      AdMob.addListener("bannerAdSizeChanged", function (size) { setAdHeight(size && size.height); });
      loadInterstitial();
    } catch (e) {
      console.warn("AdMob init failed", e);
    }
  }

  async function loadInterstitial() {
    if (!AdMob) return;
    try {
      await AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID, isTesting: true });
      interstitialReady = true;
    } catch (e) {
      interstitialReady = false;
      console.warn("Interstitial preload failed", e);
    }
  }

  async function showBanner() {
    if (!AdMob || !ready) return;
    try {
      await AdMob.showBanner({
        adId: BANNER_ID,
        adSize: "ADAPTIVE_BANNER",
        position: "BOTTOM_CENTER",
        isTesting: true
      });
      document.body.classList.add("ad-on");
    } catch (e) {
      console.warn("Banner show failed", e);
    }
  }

  async function hideBanner() {
    if (!AdMob || !ready) return;
    try {
      await AdMob.hideBanner();
      document.body.classList.remove("ad-on");
      setAdHeight(0);
    } catch (e) {
      console.warn("Banner hide failed", e);
    }
  }

  async function onFightFinished() {
    fightCount++;
    if (fightCount % FIGHTS_PER_INTERSTITIAL === 0 && interstitialReady && AdMob) {
      interstitialReady = false;
      try {
        await withTimeout(AdMob.showInterstitial(), 180000, null);
      } catch (e) {
        console.warn("Interstitial show failed", e);
      }
      loadInterstitial();
    }
  }

  // Never let the UI hang on a promise the ad SDK may simply never settle.
  // showRewardVideoAd() does not reliably resolve when the user backs out of
  // the ad, which left the WATCH AD button stuck reading "LOADING AD..."
  // forever - the game looked frozen even though it was fine.
  function withTimeout(p, ms, fallback) {
    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (v) { if (!settled) { settled = true; resolve(v); } };
      const t = setTimeout(function () { finish(fallback); }, ms);
      Promise.resolve(p).then(
        function (v) { clearTimeout(t); finish(v); },
        function (e) { clearTimeout(t); console.warn("ad promise rejected", e); finish(fallback); }
      );
    });
  }

  // Rewarded video -> the game pays out 2 gems, but ONLY if the user actually
  // earned the reward. Resolves false when the ad is unavailable or dismissed early.
  async function showRewarded() {
    if (!AdMob || !ready) return false;
    try {
      await withTimeout(
        AdMob.prepareRewardVideoAd({ adId: REWARDED_ID, isTesting: true }), 15000, null);
      const reward = await withTimeout(AdMob.showRewardVideoAd(), 180000, null);
      return !!(reward && reward.amount > 0);
    } catch (e) {
      console.warn("Rewarded ad failed", e);
      return false;
    }
  }

  return { init, showBanner, hideBanner, onFightFinished, showRewarded };
})();
document.addEventListener("DOMContentLoaded", function () { window.Ads.init(); });
