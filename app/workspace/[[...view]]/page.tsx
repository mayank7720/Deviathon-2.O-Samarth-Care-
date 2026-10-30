import {notFound} from 'next/navigation';
import {siteRoute} from '../../../lib/site-links.mjs';

export const metadata={title:'Care workspace | SwasthSync',robots:{index:false,follow:false}};

export default async function WorkspacePage({params}:{params:Promise<{view?:string[]}>}) {
  const {view=[]}=await params;
  if(siteRoute('/workspace/'+view.join('/')).kind!=='workspace')notFound();
  return null;
}
