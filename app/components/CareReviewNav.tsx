"use client";
import Link from './WorkspaceLink';
import {workspacePath} from '../../lib/site-links.mjs';
export default function CareReviewNav({active,onNavigate}:{active:string;onNavigate?:()=>void}){
 return <nav className="care-review-nav" aria-label="Health review">{[['analysis','Risk & wellbeing'],['monitoring','Health charts'],['medications','Medication patterns'],['reports','Weekly AI summaries']].map(([id,label])=><Link key={id} href={workspacePath(id)} aria-current={active===id?'page':undefined} onClick={onNavigate}>{label}</Link>)}</nav>;
}
