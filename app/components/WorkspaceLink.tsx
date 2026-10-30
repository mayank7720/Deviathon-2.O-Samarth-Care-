"use client";
import Link from 'next/link';
import type {ComponentProps} from 'react';
import {siteRoute} from '../../lib/site-links.mjs';

/** All workspace sections use one mounted client shell. Native history updates
 * Next's pathname immediately without requesting another identical shell. */
export default function WorkspaceLink({onClick,href,...props}:ComponentProps<typeof Link>){
 return <Link {...props} href={href} onClick={event=>{
  onClick?.(event);
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||props.target&&props.target!=='_self'||typeof href!=='string'||siteRoute(window.location.pathname).kind!=='workspace'||siteRoute(href).kind!=='workspace')return;
  event.preventDefault();if(window.location.pathname!==href)window.history.pushState(null,'',href);
  window.scrollTo({top:0,behavior:'instant'});
 }}/>;
}
