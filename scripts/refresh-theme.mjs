// Migración mecánica de la paleta provisional y el tamaño mínimo de texto.
// No toca lógica, datos ni archivos de configuración.
import {readFile,writeFile} from "node:fs/promises";
const files=["src/app/pos/pos.module.css","src/app/pos/menu-panel.module.css","src/app/pos/cash-panel.module.css","src/app/login/login.module.css"];
const colors={
  "#344f2f":"var(--brand)","#273f23":"var(--brand-dark)","#334d2e":"var(--brand)","#334f2f":"var(--brand)","#345028":"var(--brand)","#263f22":"var(--brand-dark)","#202821":"var(--ink)",
  "#edf3e6":"var(--blue-soft)","#edf3e7":"var(--blue-soft)","#eef4e7":"var(--blue-soft)","#eef4e6":"var(--blue-soft)","#eef4e5":"var(--blue-soft)","#f2f5eb":"var(--yellow-soft)","#f1f5ea":"var(--yellow-soft)","#edf2e2":"var(--yellow-soft)","#edf3e5":"var(--yellow-soft)",
  "#415b36":"var(--brand)","#415f31":"var(--brand)","#37532b":"var(--brand)","#36533c":"var(--brand)","#354d2e":"var(--brand)","#38512e":"var(--brand)","#314a29":"var(--brand)","#354f2a":"var(--brand)","#506b40":"var(--brand)","#536a43":"var(--brand)","#263e2a":"var(--ink)",
  "#738965":"var(--blue)","#8da379":"var(--blue)","#8ea477":"var(--blue)","#9cab8a":"var(--blue)",
};
for(const file of files){
  const path=new URL("../"+file,import.meta.url);
  let css=await readFile(path,"utf8");
  css=css.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g,(_,n)=>`font-size: ${Math.max(16,Number(n))}px`);
  css=css.replace(/#[a-f0-9]{6}\b/gi,value=>colors[value.toLowerCase()]??value);
  await writeFile(path,css);
}
console.log("Paleta provisional y texto mínimo de 16 px actualizados en cuatro hojas de estilo.");
