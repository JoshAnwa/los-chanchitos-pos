import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn(process.execPath,[fileURLToPath(new URL("../node_modules/next/dist/bin/next",import.meta.url)),"start","-p","3181"],{
  cwd:fileURLToPath(new URL("..",import.meta.url)),stdio:["ignore","pipe","pipe"],windowsHide:true,
});
let logs="";
try {
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error("El servidor no inició: "+logs)),20000);
    child.stdout.on("data",data=>{
      logs+=data.toString();
      if(logs.includes("Ready")){clearTimeout(timeout);resolve();}
    });
    child.stderr.on("data",data=>{logs+=data.toString();});
    child.once("error",error=>{clearTimeout(timeout);reject(error);});
    child.once("exit",code=>{clearTimeout(timeout);reject(new Error("El servidor terminó: "+code+" "+logs));});
  });
  const pos=await fetch("http://localhost:3181/pos",{redirect:"manual"});
  assert.ok([307,308].includes(pos.status));
  assert.equal(new URL(pos.headers.get("location"),"http://localhost:3181").pathname,"/login");
  const login=await fetch("http://localhost:3181/login");
  assert.equal(login.status,200);
  const html=await login.text();
  assert.ok(!html.includes("Ver demostración"),"Producción no debe ofrecer acceso de demostración");
  assert.ok(!html.includes("Agregar Mojarra"),"El catálogo no debe aparecer sin sesión");
  console.log("✓ Producción redirige a acceso y no expone la demostración ni el POS sin sesión.");
} finally { child.kill(); }
