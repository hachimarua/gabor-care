const CACHE_NAME = "gabor-care-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = {};
  }
  const notification = self.registration.showNotification(data.title || "ガボールアイ", {
    body: data.body || "3分だけ、絵探しゲームをやってみませんか？",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "gabor-care-nudge",
    renotify: false,
    data: { url: data.url || "./#nudge" },
  });
  const badge = self.navigator.setAppBadge?.(1) || Promise.resolve();
  event.waitUntil(Promise.all([notification, badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./#nudge", self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients[0]) {
      await clients[0].navigate(url);
      return clients[0].focus();
    }
    return self.clients.openWindow(url);
  })());
});
