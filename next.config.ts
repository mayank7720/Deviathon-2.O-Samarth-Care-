import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects(){return [
    {source:'/login',destination:'/sign-in',permanent:true},
    {source:'/signin',destination:'/sign-in',permanent:true},
    {source:'/workspace',destination:'/workspace/dashboard',permanent:false},
  ];},
};

export default nextConfig;
