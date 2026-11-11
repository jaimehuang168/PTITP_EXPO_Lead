const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const {installGasAuth} = require('./test_helpers/gas-auth.cjs');

const backend = fs.readFileSync('Code.gs', 'utf8');
const spreadsheetId = 'fixture-private-visit-spreadsheet-id';
const leadId = 'V-261111-141100-123';
const base = [
  [leadId,'11/11/2026 14:11:00','Empresa A','Contacto A','Inversionista','Arrendamiento de terreno','65',
    '6 a 12 meses','2','Pendiente','Comercial','Contactable','1 · Prioritario','Confirmar unidad y plazo.',
    'contacto@example.invalid','+59500000000','0','1','0','0','0','0'],
  ['V-261111-170431-456','11/11/2026 17:04:31','Empresa B','Contacto B','Inversionista','Nave',
    '200','Inmediato','1','Aprobado','Comercial','No autorizado','1 · Prioritario','Validar superficie.',
    'sin-permiso@example.invalid','+59599999999','1','0','0','0','0','0'],
  ['V-261111-170500-789','11/11/2026 17:05:00','Institución C','','Universidad','','','',
    '3','Lista de espera','Visita','','','','','','0','0','0','0','0','0']
];
const tracking = [[leadId,'Empresa A','Reunión agendada','Responsable A','Preparar ficha del lote.','17/11/2026','Nota privada']];
let openCount = 0;
let activeReads = 0;

function fixture(email) {
  const context = {
    Date,
    Utilities:{formatDate:()=> '11/11/2026 17:06'},
    ContentService:{MimeType:{JSON:'json'},createTextOutput(text){return {text,setMimeType(){return this;}};}},
    SpreadsheetApp:{
      getActiveSpreadsheet(){
        activeReads++;
        return {getSheetByName:name=>name==='Config' ? {
          getDataRange:()=>({getDisplayValues:()=>[['Panel de visitas · pbw-2026',spreadsheetId,'','Base','Gestión']]})
        } : null};
      },
      openById(id){
        assert.equal(id, spreadsheetId);
        openCount++;
        return {
          getUrl:()=> 'https://docs.google.com/spreadsheets/d/fixture-private-visit-spreadsheet-id/edit',
          getSheetByName:name=>name==='Base' ? source(1, 'VISIT_PANEL_HEADERS', base)
            : name==='Gestión' ? source(5, 'VISIT_TRACKING_HEADERS', tracking) : null
        };
      }
    }
  };
  function source(start, headerConstant, rows) {
    return {
      getLastRow:()=>start+rows.length,
      getSheetId:()=>42,
      getRange(row,col,count,width){
        assert.equal(row,start);
        assert.equal(col,1);
        assert.equal(count,rows.length+1);
        const headers = vm.runInContext(headerConstant, context);
        assert.equal(width,headers.length);
        return {getDisplayValues:()=>[headers,...rows]};
      }
    };
  }
  const idToken = installGasAuth(context,{email});
  vm.createContext(context);
  vm.runInContext(backend, context);
  return (eventId='pbw-2026', signed=true)=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({
    accion:'panelVisitas', eventoId:eventId, idToken:signed ? idToken : undefined,
    spreadsheetId:'untrusted-sheet-ignored'
  })}}).text);
}

async function run() {
  const staff = fixture('operador@example.invalid');
  const admin = fixture('jaimehuang168@gmail.com');
  assert.equal(staff().ok, false);
  assert.equal(admin('pbw-2026', false).ok, false);
  assert.equal(activeReads, 0);
  assert.equal(openCount, 0);
  assert.equal(admin('expo-paraguay-2026').disponible, false);
  assert.equal(openCount, 0);

  const result = admin();
  assert.equal(result.ok, true);
  assert.equal(openCount, 1);
  assert.deepEqual(
    [result.totales.solicitudes,result.totales.personas,result.totales.oportunidades,
      result.totales.contactables,result.totales.noAutorizadas],
    [3,6,2,1,1]
  );
  assert.equal(result.demanda.find(item=>item.nombre==='Nave / galpón').cantidad,1);
  assert.equal(result.prospectos[0].estado,'Reunión agendada');
  assert.equal(result.prospectos[0].responsable,'Responsable A');
  assert.equal(result.prospectos[0].superficie,'65');
  assert.equal(result.prospectos[0].accion,'Preparar ficha del lote.');
  assert.ok(!JSON.stringify(result).includes('sin-permiso@example.invalid'));
  assert.ok(!JSON.stringify(result).includes('Nota privada'));
  tracking[0][2] = 'No continuar';
  assert.equal(admin().prospectos[0].correo, '');
  tracking[0][2] = 'Reunión agendada';

  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    runScripts:'outside-only',url:'https://example.invalid/'
  });
  const {window} = dom;
  const document = window.document;
  const byId = id=>document.getElementById(id);
  const tab = byId('tab-reportes');
  const select = byId('rep-evento');
  select.append(new window.Option('PBW','pbw-2026'), new window.Option('Otra','expo-paraguay-2026'));
  select.value = 'pbw-2026';
  window.eval(fs.readFileSync('visit-reports.js','utf8'));
  let user = {uid:'fixture-admin',admin:true};
  let requests = 0;
  let resolve;
  const view = window.PtitpVisitReports.init({
    getSnapshot:()=>({user}),
    isOffline:()=>false,
    fetchReport:eventId=>{
      requests++;
      if (eventId !== 'pbw-2026') return Promise.resolve({ok:true,disponible:false});
      return new Promise(done=>{resolve=done;});
    }
  });
  view.sync();
  assert.equal(requests,0);
  tab.classList.add('activa');
  view.sync();
  assert.equal(requests,1);
  user = null;
  view.sync();
  resolve(result);
  await new Promise(setImmediate);
  assert.equal(byId('panel-visitas').hidden,true);
  assert.equal(byId('visit-report-queue').textContent,'');

  user = {uid:'fixture-admin',admin:true};
  view.sync();
  resolve(result);
  await new Promise(setImmediate);
  assert.match(byId('visit-report-queue').textContent,/Empresa A/);
  assert.match(byId('visit-report-queue').textContent,/17\/11\/2026/);
  assert.equal(byId('visit-report-filters').querySelectorAll('button').length,4);
  assert.equal(byId('visit-report-link').getAttribute('href'),result.urlSeguimiento);
  byId('visit-report-filters').querySelector('[data-priority="exploracion"]').click();
  assert.match(byId('visit-report-queue').textContent,/No hay prospectos/);
  select.value = 'expo-paraguay-2026';
  select.dispatchEvent(new window.Event('change'));
  await new Promise(setImmediate);
  assert.equal(byId('visit-report-link').hasAttribute('href'),false);
  assert.match(byId('visit-report-message').textContent,/no tiene un panel/);
  window.close();
  console.log('PASS admin-only visit data, consent, linked tracking and session-safe panel');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
