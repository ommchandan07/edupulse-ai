import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const app=express();
const PORT=process.env.PORT||3000;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024}});
const ai=process.env.GEMINI_API_KEY?new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY}):null;
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(process.cwd(),'public')));

function checkAI(res){if(!ai){res.status(500).json({error:'Gemini API key is missing. Create .env and add GEMINI_API_KEY.'});return false}return true}
async function ask(prompt,extra){
  const input=[{type:'text',text:prompt}]; if(extra) input.push(extra);
  const r=await ai.interactions.create({model:'gemini-3.8-flash',input});
  return r.output_text||'No AI response was returned.';
}
function pptText(buffer){
  const z=new AdmZip(buffer); const slides=z.getEntries().filter(e=>/^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName)).sort((a,b)=>Number(a.entryName.match(/slide(\d+)/i)[1])-Number(b.entryName.match(/slide(\d+)/i)[1]));
  if(!slides.length)throw new Error('No readable slides found in this PPTX.');
  return slides.map((e,i)=>`SLIDE ${i+1}\n`+e.getData().toString('utf8').replace(/<a:t[^>]*>(.*?)<\/a:t>/g,' $1 ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()).join('\n\n');
}

app.post('/api/topic-notes',async(req,res)=>{if(!checkAI(res))return;try{
 const {topic,language='English',level='University / Exam'}=req.body;if(!topic?.trim())return res.status(400).json({error:'Enter a topic first.'});
 const text=await ask(`You are EduPulse AI, a student study assistant. Create accurate study notes for: "${topic.trim()}". Answer in ${language}. Student level: ${level}. Include: simple definition; key concepts; step-by-step explanation; formulas/facts if relevant; one real-world example; exam-focused points; 5 quick revision questions. Keep it structured and easy to study. Do not invent syllabus-specific facts.`);
 res.json({text});
}catch(e){res.status(500).json({error:e.message||'AI request failed.'})}});

app.post('/api/analyze-file',upload.single('file'),async(req,res)=>{if(!checkAI(res))return;if(!req.file)return res.status(400).json({error:'Choose a file first.'});try{
 const name=req.file.originalname,ext=path.extname(name).toLowerCase(),lang=req.body.language||'English';
 const prompt=`You are EduPulse AI. Analyze the uploaded study material "${name}". Answer in ${lang}. Return: short overview; clean study notes; important definitions/concepts; formulas/facts present; exam-focused points; 5 revision questions. Use only information supported by the material and clearly say when something is unclear.`;
 if(['.pptx'].includes(ext)){const t=pptText(req.file.buffer);return res.json({text:await ask(prompt+'\n\nExtracted slide text:\n'+t.slice(0,180000)),fileName:name})}
 if(['.txt','.md','.csv'].includes(ext)){const t=req.file.buffer.toString('utf8');return res.json({text:await ask(prompt+'\n\nMaterial:\n'+t.slice(0,180000)),fileName:name})}
 if(ext!=='.pdf')return res.status(400).json({error:'Supported files: PDF, PPTX, TXT, MD, CSV.'});
 const tmp=path.join(os.tmpdir(),'edupulse-'+Date.now()+'.pdf');await fs.writeFile(tmp,req.file.buffer);
 try{const f=await ai.files.upload({file:tmp,config:{mimeType:'application/pdf'}});return res.json({text:await ask(prompt,{type:'document',uri:f.uri,mime_type:f.mimeType||'application/pdf'}),fileName:name})}finally{await fs.unlink(tmp).catch(()=>{})}
}catch(e){console.error(e);res.status(500).json({error:e.message||'Could not analyze the file.'})}});

app.post('/api/youtube',async(req,res)=>{if(!checkAI(res))return;try{
 const {url,language='English'}=req.body;if(!url?.trim())return res.status(400).json({error:'Paste a YouTube URL first.'});
 if(!/^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/i.test(url.trim()))return res.status(400).json({error:'Enter a valid public YouTube URL.'});
 const text=await ask(`You are EduPulse AI. Analyze this public educational YouTube video. Answer in ${language}. Give: (1) a short 3-5 sentence explanation, (2) main concepts, (3) exam-important points, (4) key terms/formulas, (5) 5 revision questions. Do not claim details you cannot verify from the video.`,{type:'video',uri:url.trim()});
 res.json({text});
}catch(e){console.error(e);res.status(500).json({error:'The video could not be analyzed. Make sure it is public and try again.'})}});

app.listen(PORT,()=>console.log(`EduPulse AI: http://localhost:${PORT}`));
