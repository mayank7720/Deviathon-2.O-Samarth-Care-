/* Generic notifications intentionally contain no names, readings or health notes. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  event.waitUntil(self.registration.showNotification('SwasthSync update',{body:'Open your care inbox for an update.',icon:'/favicon.svg',tag:'swasthsync-update',data:{url:'/workspace/deliveries'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const target=new URL('/workspace/deliveries',self.location.origin).href;const client=clients.find(c=>new URL(c.url).origin===self.location.origin);if(client){await client.navigate(target);return client.focus();}return self.clients.openWindow(target);}));
});
