const CACHE='signbridge-shell-v7';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// Do not cache app.js or external vision/model assets. This prevents stale vision code.
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.pathname.endsWith('/app.js') || u.pathname.endsWith('/sw.js')) return;
 e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
