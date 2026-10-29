/* Generic notifications intentionally contain no names, readings or health notes. */
self.addEventListener('push',event=>{
  event.waitUntil(self.registration.showNotification('Samarth Care update',{body:'Open your care inbox for an update.',icon:'/favicon.svg',tag:'samarth-care-update',data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const client=clients.find(c=>new URL(c.url).origin===self.location.origin);if(client)return client.focus();return self.clients.openWindow('/');}));
});
