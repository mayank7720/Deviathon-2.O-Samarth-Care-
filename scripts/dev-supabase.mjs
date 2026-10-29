process.env.CLOUDFLARE_ENV='supabase';
const args=process.argv.slice(2);
process.argv=[process.argv[0],process.argv[1],'dev',...(!args.includes('--port')?['--port','5173']:[]),...args];
await import('./run-framework.mjs');
