import {notFound} from 'next/navigation';
import Home from '../page';
import {siteRoute} from '../../lib/site-links.mjs';
export async function generateMetadata({params}:{params:Promise<{path:string[]}>}){
 const {path}=await params,route=siteRoute('/'+path.join('/'));
 const title=({'sign-in':'Sign in',register:'Create account',invitations:'Accept invitation','how-it-works':'How it works','for-families':'For families',questions:'Questions',workspace:'Care workspace'} as Record<string,string>)[route.kind]||'Page not found';
 return {title:title+' | SwasthSync',robots:{index:!['workspace','sign-in','register','invitations'].includes(route.kind),follow:true}};
}

export default async function SitePage({params}:{params:Promise<{path:string[]}>}){
 const {path}=await params;
 if(siteRoute('/'+path.join('/')).kind==='not-found')notFound();
 return <Home/>;
}
