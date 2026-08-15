const crypto=require("crypto");
const COOKIE="uber_flame_admin";
function secret(){return process.env.AUTH_SECRET||""}
function sign(payload){return crypto.createHmac("sha256",secret()).update(payload).digest("hex")}
function makeToken(){
  const payload=Buffer.from(JSON.stringify({exp:Date.now()+8*60*60*1000})).toString("base64url");
  return payload+"."+sign(payload);
}
function validToken(token){
  if(!token||!secret())return false;
  const [p,s]=token.split("."); if(!p||!s)return false;
  const expected=sign(p);
  try{
    if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected))) return false;
    const data=JSON.parse(Buffer.from(p,"base64url").toString("utf8"));
    return data.exp>Date.now();
  }catch{return false}
}
function cookieValue(req){
  const raw=req.headers.cookie||"";
  const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));
  return part?decodeURIComponent(part.slice(COOKIE.length+1)):"";
}
function requireAdmin(req,res){
  if(!validToken(cookieValue(req))){res.status(401).json({ok:false,error:"Unauthorized"});return false}
  return true;
}
module.exports={COOKIE,makeToken,requireAdmin};