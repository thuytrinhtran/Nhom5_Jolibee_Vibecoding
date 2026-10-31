import type { DemandContext, DemandInput, DemandRequirement } from '../types/scheduling';
import { demandDays, demandRowKey } from './staffing-demand.view';
export type CellValue = { count:string; forecast:string };
export type DemandDraft = Record<string,CellValue>;
export type GridCell = {work_date:string;shift_id:string;department_id:string};
export function gridShifts(data:Pick<DemandContext,'shifts'>) {
  return data.shifts.filter(s=>s.is_active).sort((a,b)=>a.start_time.localeCompare(b.start_time)||a.id.localeCompare(b.id));
}
export function gridDepartments(data:Pick<DemandContext,'departments'>) {
  const order=['Bếp','Thu ngân','Phục vụ'];
  return [...data.departments].sort((a,b)=>(order.includes(a.name)?order.indexOf(a.name):3)-(order.includes(b.name)?order.indexOf(b.name):3)||a.name.localeCompare(b.name));
}
export function gridCells(data:DemandContext):GridCell[] {
  return demandDays(data).flatMap(work_date=>gridShifts(data).flatMap(shift=>gridDepartments(data).map(d=>({work_date,shift_id:shift.id,department_id:d.id}))));
}
export function demandSyncMessage(data:DemandContext,dirty:number,saving:boolean,error:string) {
  if(saving)return 'Đang lưu nhu cầu…';
  if(error)return 'Cần kiểm tra dữ liệu trước khi lập lịch.';
  if(dirty)return `${dirty} ô chưa lưu trên toàn tuần`;
  const cells=gridCells(data);
  if(!cells.length)return 'Chưa đủ danh mục ca và bộ phận để nhập nhu cầu.';
  const known=cells.filter(c=>data.requirements.some(r=>demandRowKey(r)===demandRowKey(c)&&Number.isInteger(r.required_count)&&r.required_count>=0)).length;
  if(!known)return 'Chưa nhập nhu cầu nhân sự cho tuần này.';
  if(known<cells.length)return `Đã lưu ${known}/${cells.length} ô nhu cầu; còn ô chưa xác định.`;
  return 'Đã đồng bộ đầy đủ nhu cầu. Mở lịch dự kiến để kiểm tra điều kiện xếp lịch.';
}
export function storedValue(data:DemandContext,key:string):CellValue {
  const r=data.requirements.find(row=>demandRowKey(row)===key);
  return {count:r?String(r.required_count):'',forecast:r?.sales_forecast_ref??''};
}
export function cellValue(data:DemandContext,draft:DemandDraft,key:string) { return draft[key]??storedValue(data,key); }
export function updateCell(data:DemandContext,draft:DemandDraft,key:string,value:CellValue):DemandDraft {
  const next={...draft},saved=storedValue(data,key);
  if(value.count===saved.count&&value.forecast===saved.forecast) delete next[key]; else next[key]=value;
  return next;
}
export function countError(value:string) {
  return value!==''&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)?'Nhập số nguyên không âm (tối đa 2147483647).':'';
}
export function copyDays(data:DemandContext,draft:DemandDraft,source:string,targets:string[]):DemandDraft {
  let next={...draft};
  for(const c of gridCells(data).filter(c=>targets.includes(c.work_date))) {
    const key=demandRowKey(c),sourceKey=demandRowKey({...c,work_date:source});
    next=updateCell(data,next,key,{...cellValue(data,next,key),count:cellValue(data,draft,sourceKey).count});
  }
  return next;
}
export function overwritesSaved(data:DemandContext,before:DemandDraft,after:DemandDraft) {
  return data.requirements.some(r=>{const key=demandRowKey(r);return cellValue(data,before,key).count!==cellValue(data,after,key).count;});
}
export function pasteGrid(data:DemandContext,draft:DemandDraft,start:GridCell,text:string):DemandDraft {
  const cells=gridCells(data),cols=gridDepartments(data).length,startIndex=cells.findIndex(c=>demandRowKey(c)===demandRowKey(start));
  const lines=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(line=>line.split('\t').map(s=>s.trim()));
  let next={...draft};
  for(let y=0;y<lines.length;y++)for(let x=0;x<lines[y].length;x++){
    const i=startIndex+y*cols+x;
    if(startIndex<0||startIndex%cols+x>=cols||i>=cells.length)throw new Error('Vùng dán vượt quá bảng. Chọn lại ô bắt đầu.');
    if(countError(lines[y][x]))throw new Error('Vùng dán có dữ liệu không phải số nguyên không âm.');
    const key=demandRowKey(cells[i]);next=updateCell(data,next,key,{...cellValue(data,next,key),count:lines[y][x]});
  }
  return next;
}
export interface DemandWriter {
  saveDemand(period:string,input:DemandInput):Promise<{requirement:DemandRequirement}>;
  clearDemand(period:string,input:Pick<DemandInput,'work_date'|'shift_id'|'department_id'|'expected_updated_at'>):Promise<void>;
}
// Existing single-row APIs retain optimistic concurrency. Partial failures stay editable and retryable.
export async function saveGrid(data:DemandContext,draft:DemandDraft,writer:DemandWriter,onProgress:(done:number,total:number)=>void=()=>{}) {
  const errors:Record<string,string>={},remaining:DemandDraft={...draft};let requirements=[...data.requirements],saved=0,done=0;
  const changes=gridCells(data).filter(c=>draft[demandRowKey(c)]);
  for(const c of changes) {
    const key=demandRowKey(c),value=draft[key],existing=data.requirements.find(r=>demandRowKey(r)===key);
    try {
      const error=countError(value.count);if(error)throw new Error(error);
      if(value.count===''&&!existing&&value.forecast.trim())throw new Error('Cần nhập nhu cầu trước khi lưu nguồn forecast; ô trống là chưa xác định.');
      const selection={...c,expected_updated_at:existing?.updated_at??null};
      if(value.count==='') {
        if(existing) await writer.clearDemand(data.period.id,selection);
        requirements=requirements.filter(r=>demandRowKey(r)!==key);
      } else {
        const result=await writer.saveDemand(data.period.id,{...selection,required_count:Number(value.count),required_skill_name:existing?.required_skill_name??null,sales_forecast_ref:value.forecast.trim()||null});
        requirements=[...requirements.filter(r=>demandRowKey(r)!==key),result.requirement];
      }
      delete remaining[key];saved++;
    }catch(error){errors[key]=error instanceof Error?error.message:'Không thể lưu ô này.';}
    onProgress(++done,changes.length);
  }
  return {requirements,remaining,errors,saved,total:changes.length};
}
