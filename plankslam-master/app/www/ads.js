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

  async function init() {
    if (!AdMob) return;
    try {
      await AdMob.initialize({ initializeForTesting: true });
      ready = true;
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
    } catch (e) {
      console.warn("Banner show failed", e);
    }
  }

  async function hideBanner() {
    if (!AdMob || !ready) return;
    try {
      await AdMob.hideBanner();
    } catch (e) {
      console.warn("Banner hide failed", e);
    }
  }

  async function onFightFinished() {
    fightCount++;
    if (fightCount % FIGHTS_PER_INTERSTITIAL === 0 && interstitialReady && AdMob) {
      interstitialReady = false;
      try {
        await AdMob.showInterstitial();
      } catch (e) {
        console.warn("Interstitial show failed", e);
      }
      loadInterstitial();
    }
  }

  // Rewarded video -> the game pays out 2 gems, but ONLY if the user actually
  // earned the reward. Resolves false when the ad is unavailable or dismissed early.
  async function showRewarded() {
    if (!AdMob || !ready) return false;
    try {
      await AdMob.prepareRewardVideoAd({ adId: REWARDED_ID, isTesting: true });
      const reward = await AdMob.showRewardVideoAd();
      return !!(reward && reward.amount > 0);
    } catch (e) {
      console.warn("Rewarded ad failed", e);
      return false;
    }
  }

  return { init, showBanner, hideBanner, onFightFinished, showRewarded };
})();
document.addEventListener("DOMContentLoaded", function () { window.Ads.init(); });
