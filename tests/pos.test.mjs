import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compilar el módulo puro real, sin duplicar su lógica ni requerir Node con soporte TS nativo.
const source = await readFile(new URL("../src/lib/pos.ts",import.meta.url),"utf8");
const javascript = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {newDraft,normalize,orderTotal,roundMoney,money,paymentLabels} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("cada borrador tiene líneas independientes y notas vacías", () => {
  const a=newDraft(),b=newDraft();
  a.lines.push({id:"test",name:"Test",price:25,quantity:1});
  assert.equal(b.lines.length,0); assert.equal(a.notes,""); assert.equal(b.notes,"");
});
test("la búsqueda normaliza mayúsculas y acentos", () => {
  assert.equal(normalize("TÁCOS"),"tacos"); assert.equal(normalize("Menú del día"),"menu del dia");
});
test("el total vacío es cero y respeta cantidades", () => {
  assert.equal(orderTotal([]),0);
  assert.equal(orderTotal([{price:25,quantity:2},{price:30,quantity:1}]),80);
});
test("los importes se redondean a centavos", () => {
  assert.equal(roundMoney(1.005),1.01); assert.equal(roundMoney(2.675),2.68);
  assert.equal(orderTotal([{price:0.1,quantity:3},{price:0.2,quantity:1}]),0.5);
});
test("el formato monetario usa dos decimales y pesos", () => {
  assert.equal(money.format(55),"$55.00"); assert.equal(money.format(0),"$0.00");
});
test("todos los métodos tienen una etiqueta para el negocio", () => {
  assert.deepEqual(paymentLabels,{cash:"Efectivo",card:"Tarjeta",transfer:"Transferencia",combined:"Combinado"});
});
