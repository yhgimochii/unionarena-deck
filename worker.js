export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if(request.method === "OPTIONS"){
      return new Response(null,{status:204,headers:cors});
    }

    const incoming=new URL(request.url);
    const target=incoming.searchParams.get("url");

    if(!target){
      return new Response("Missing ?url=",{status:400,headers:cors});
    }

    let url;
    try{ url=new URL(target); }
    catch{ return new Response("Invalid URL",{status:400,headers:cors}); }

    if(!["rugiacreation.com","www.rugiacreation.com"].includes(url.hostname)){
      return new Response("Only rugiacreation.com is allowed",{status:403,headers:cors});
    }

    try{
      const upstream=await fetch(url.toString(),{
        headers:{
          "User-Agent":"Mozilla/5.0 UA Deck Analyzer",
          "Accept":"text/html,application/xhtml+xml"
        }
      });

      const body=await upstream.text();

      return new Response(body,{
        status:upstream.status,
        headers:{
          ...cors,
          "Content-Type":"text/html; charset=UTF-8",
          "Cache-Control":"public,max-age=3600"
        }
      });
    }catch(error){
      return new Response("Rugia proxy error: "+error.message,{
        status:502,
        headers:cors
      });
    }
  }
};
