/**
 * A synthetic laboratory catalogue for hms_dev, so doctors can order and the lab can run a
 * realistic range of tests: haematology, coagulation, diabetes, lipids, liver, kidney,
 * electrolytes, thyroid, hormones, cardiac markers, inflammation and immunology, vitamins and
 * iron, infection serology, urine, stool, microbiology, tumour markers, body fluids and
 * pathology, plus health checkup packages.
 *
 * Reference ranges are typical adult ranges written for a demonstration. Each real laboratory
 * sets its own ranges, so nothing here is a clinical recommendation. Where a range depends on
 * sex, age or cycle phase it is given as text (no automatic low/high flag). Prices are
 * invented.
 *
 * The three starter tests from db:seed:demo:catalogue (CBC, FBS, LFT) are not repeated here.
 * Safe to re-run: a test is added only when neither its code nor its LAB-<code> price-list
 * entry exists yet; nothing is updated or deleted. One audit row with counts when something
 * was added.
 */
import { SYSTEM, recordAudit } from '../../lib/audit.js';
import type { Queryable } from '../client.js';
import { DEMO_DEPARTMENTS } from './demo-data.js';
import { DEPARTMENT_DIAGNOSTICS, TEST_DEPARTMENTS } from './demo-lab-department-tests.js';
import { SPECIALIST_DEPARTMENTS } from './demo-specialists.js';

const LOCK = 4_200_408;

/** [name, unit, ref low, ref high, ref text] */
export type LabParam = [
  name: string,
  unit: string | null,
  low: number | null,
  high: number | null,
  text?: string,
];

/** [code, name, sample type, turnaround hours, price in paise, parameters] */
export type LabTestRow = [
  code: string,
  name: string,
  sample: string,
  turnaroundHours: number,
  pricePaise: number,
  params: LabParam[],
];

export interface DemoLabTest {
  code: string;
  name: string;
  sample: string;
  turnaroundHours: number;
  pricePaise: number;
  params: LabParam[];
  category: string;
}

// Shared parameters, reused by single tests and the checkup packages.
const HB: LabParam = ['Haemoglobin', 'g/dL', null, null, 'Men 13–17; women 12–15'];
const WBC: LabParam = ['WBC count', '10^3/µL', 4, 11];
const PLT: LabParam = ['Platelet count', '10^3/µL', 150, 450];
const ESR: LabParam = ['ESR', 'mm/h', null, null, 'Men 0–15; women 0–20'];
const GLU_F: LabParam = ['Glucose, fasting', 'mg/dL', 70, 100];
const GLU_PP: LabParam = ['Glucose, 2 h after a meal', 'mg/dL', 70, 140];
const GLU_R: LabParam = ['Glucose, random', 'mg/dL', 70, 140];
const HBA1C: LabParam = ['HbA1c', '%', 4, 5.6];
const CHOL: LabParam = ['Total cholesterol', 'mg/dL', null, 200];
const TG: LabParam = ['Triglycerides', 'mg/dL', null, 150];
const HDL: LabParam = ['HDL cholesterol', 'mg/dL', 40, null];
const LDL: LabParam = ['LDL cholesterol', 'mg/dL', null, 100];
const VLDL: LabParam = ['VLDL cholesterol', 'mg/dL', 5, 40];
const UREA: LabParam = ['Urea', 'mg/dL', 15, 45];
const CREAT: LabParam = ['Creatinine', 'mg/dL', 0.6, 1.3];
const EGFR: LabParam = ['eGFR', 'mL/min/1.73 m²', 90, null];
const URIC: LabParam = ['Uric acid', 'mg/dL', 3.4, 7];
const NA: LabParam = ['Sodium', 'mmol/L', 135, 145];
const K: LabParam = ['Potassium', 'mmol/L', 3.5, 5.1];
const CL: LabParam = ['Chloride', 'mmol/L', 98, 107];
const HCO3: LabParam = ['Bicarbonate', 'mmol/L', 22, 29];
const CA: LabParam = ['Calcium, total', 'mg/dL', 8.6, 10.3];
const ALT: LabParam = ['ALT', 'U/L', 7, 56];
const AST: LabParam = ['AST', 'U/L', 10, 40];
const ALP: LabParam = ['Alkaline phosphatase', 'U/L', 44, 147];
const GGT: LabParam = ['GGT', 'U/L', 8, 61];
const TBIL: LabParam = ['Total bilirubin', 'mg/dL', 0.1, 1.2];
const DBIL: LabParam = ['Direct bilirubin', 'mg/dL', 0, 0.3];
const TPROT: LabParam = ['Total protein', 'g/dL', 6, 8.3];
const ALB: LabParam = ['Albumin', 'g/dL', 3.5, 5];
const TSH: LabParam = ['TSH', 'µIU/mL', 0.4, 4];
const FT3: LabParam = ['Free T3', 'pg/mL', 2.3, 4.2];
const FT4: LabParam = ['Free T4', 'ng/dL', 0.89, 1.76];
const VITD: LabParam = ['Vitamin D (25-OH)', 'ng/mL', 30, 100];
const B12: LabParam = ['Vitamin B12', 'pg/mL', 200, 900];
const FERRITIN: LabParam = ['Ferritin', 'ng/mL', null, null, 'Men 24–336; women 11–307'];
const IRON: LabParam = ['Serum iron', 'µg/dL', 60, 170];
const HSCRP: LabParam = ['hs-CRP', 'mg/L', 0, 3];
const CRP: LabParam = ['CRP', 'mg/L', 0, 5];
const PT: LabParam = ['Prothrombin time', 'seconds', 11, 13.5];
const INR: LabParam = ['INR', null, 0.8, 1.2];
const APTT: LabParam = ['APTT', 'seconds', 25, 35];
const ABO: LabParam = ['ABO group', null, null, null, 'A, B, AB or O'];
const RH: LabParam = ['Rh (D) type', null, null, null, 'Positive or negative'];
const HIV: LabParam = ['HIV 1 and 2 antibodies', null, null, null, 'Non-reactive'];
const HBSAG: LabParam = ['HBsAg', null, null, null, 'Non-reactive'];
const HCV: LabParam = ['Anti-HCV', null, null, null, 'Non-reactive'];
const VDRL: LabParam = ['VDRL', null, null, null, 'Non-reactive'];
const MP_SMEAR: LabParam = ['Malaria parasite (smear)', null, null, null, 'Not seen'];
const NS1: LabParam = ['Dengue NS1 antigen', null, null, null, 'Negative'];
const DEN_IGM: LabParam = ['Dengue IgM', null, null, null, 'Negative'];
const U_PROT: LabParam = ['Urine protein', null, null, null, 'Negative'];
const U_GLU: LabParam = ['Urine glucose', null, null, null, 'Negative'];
const U_PUS: LabParam = ['Urine pus cells', '/HPF', 0, 5];
const U_RBC: LabParam = ['Urine RBCs', '/HPF', 0, 2];
const UACR: LabParam = ['Urine albumin/creatinine ratio', 'mg/g', 0, 30];
const NEG = (name: string): LabParam => [name, null, null, null, 'Negative'];
const NONREACTIVE = (name: string): LabParam => [name, null, null, null, 'Non-reactive'];
const TEXT = (name: string, text: string): LabParam => [name, null, null, null, text];

const CLASSES: Record<string, LabTestRow[]> = {
  Haematology: [
    [
      'CBC-DIFF',
      'Complete blood count with differential',
      'Blood (EDTA)',
      6,
      45000,
      [
        HB,
        ['RBC count', '10^6/µL', 4, 5.9],
        ['Haematocrit (PCV)', '%', 36, 50],
        ['MCV', 'fL', 80, 100],
        ['MCH', 'pg', 27, 33],
        ['MCHC', 'g/dL', 32, 36],
        ['RDW-CV', '%', 11.5, 14.5],
        WBC,
        ['Neutrophils', '%', 40, 75],
        ['Lymphocytes', '%', 20, 45],
        ['Monocytes', '%', 2, 10],
        ['Eosinophils', '%', 1, 6],
        ['Basophils', '%', 0, 2],
        PLT,
        ['Mean platelet volume', 'fL', 7.5, 11.5],
      ],
    ],
    ['HB', 'Haemoglobin', 'Blood (EDTA)', 2, 10000, [HB]],
    ['PLT', 'Platelet count', 'Blood (EDTA)', 2, 15000, [PLT]],
    ['ESR', 'Erythrocyte sedimentation rate', 'Blood (citrate)', 2, 15000, [ESR]],
    [
      'PS',
      'Peripheral blood smear',
      'Blood (EDTA)',
      24,
      30000,
      [
        TEXT('RBC morphology', 'Normocytic normochromic'),
        TEXT('WBC morphology', 'No abnormal cells'),
        TEXT('Platelets on smear', 'Adequate'),
        MP_SMEAR,
      ],
    ],
    ['RETIC', 'Reticulocyte count', 'Blood (EDTA)', 12, 25000, [['Reticulocytes', '%', 0.5, 2.5]]],
    [
      'AEC',
      'Absolute eosinophil count',
      'Blood (EDTA)',
      6,
      15000,
      [['Absolute eosinophil count', 'cells/µL', 30, 350]],
    ],
    ['BGRH', 'Blood group and Rh type', 'Blood (EDTA)', 2, 15000, [ABO, RH]],
    [
      'MP',
      'Malaria parasite (smear and rapid antigen)',
      'Blood (EDTA)',
      2,
      30000,
      [MP_SMEAR, NEG('P. falciparum antigen'), NEG('P. vivax antigen')],
    ],
    [
      'HB-HPLC',
      'Haemoglobin variants (HPLC)',
      'Blood (EDTA)',
      72,
      120000,
      [
        ['HbA', '%', 95, 98],
        ['HbA2', '%', 1.5, 3.5],
        ['HbF', '%', 0, 2],
      ],
    ],
    ['G6PD', 'G6PD screen', 'Blood (EDTA)', 24, 60000, [TEXT('G6PD activity', 'Normal')]],
    ['SICKLE', 'Sickling test', 'Blood (EDTA)', 24, 25000, [NEG('Sickling')]],
  ],
  Coagulation: [
    ['PT-INR', 'Prothrombin time with INR', 'Blood (citrate)', 4, 40000, [PT, INR]],
    ['APTT', 'Activated partial thromboplastin time', 'Blood (citrate)', 4, 45000, [APTT]],
    [
      'BT-CT',
      'Bleeding time and clotting time',
      'Blood (finger prick)',
      1,
      20000,
      [
        ['Bleeding time', 'minutes', 2, 7],
        ['Clotting time', 'minutes', 4, 10],
      ],
    ],
    ['DDIMER', 'D-dimer', 'Blood (citrate)', 6, 120000, [['D-dimer', 'ng/mL FEU', 0, 500]]],
    ['FIBRIN', 'Fibrinogen', 'Blood (citrate)', 12, 80000, [['Fibrinogen', 'mg/dL', 200, 400]]],
  ],
  'Diabetes and glucose': [
    ['PPBS', 'Post-prandial blood sugar', 'Blood (fluoride)', 2, 12000, [GLU_PP]],
    ['RBS', 'Random blood sugar', 'Blood (fluoride)', 2, 10000, [GLU_R]],
    [
      'HBA1C',
      'Glycated haemoglobin (HbA1c)',
      'Blood (EDTA)',
      12,
      50000,
      [HBA1C, ['Estimated average glucose', 'mg/dL', 68, 114]],
    ],
    [
      'OGTT',
      'Oral glucose tolerance test (75 g)',
      'Blood (fluoride)',
      4,
      40000,
      [GLU_F, ['Glucose, 1 hour', 'mg/dL', null, 180], ['Glucose, 2 hours', 'mg/dL', null, 140]],
    ],
    ['INSULIN', 'Insulin, fasting', 'Blood (serum)', 24, 70000, [['Insulin', 'µIU/mL', 2.6, 24.9]]],
    ['CPEP', 'C-peptide', 'Blood (serum)', 48, 90000, [['C-peptide', 'ng/mL', 1.1, 4.4]]],
    [
      'UMALB',
      'Urine microalbumin',
      'Urine (spot)',
      24,
      60000,
      [['Urine microalbumin', 'mg/L', 0, 30], UACR],
    ],
  ],
  Lipids: [
    [
      'LIPID',
      'Lipid profile',
      'Blood (serum)',
      12,
      50000,
      [
        CHOL,
        TG,
        HDL,
        LDL,
        VLDL,
        ['Non-HDL cholesterol', 'mg/dL', null, 130],
        ['Total/HDL cholesterol ratio', null, null, 5],
      ],
    ],
    [
      'APO',
      'Apolipoproteins A1 and B',
      'Blood (serum)',
      48,
      150000,
      [
        ['Apolipoprotein A1', 'mg/dL', 110, 205],
        ['Apolipoprotein B', 'mg/dL', 55, 140],
      ],
    ],
    ['LPA', 'Lipoprotein(a)', 'Blood (serum)', 48, 120000, [['Lipoprotein(a)', 'mg/dL', 0, 30]]],
  ],
  'Liver and pancreas': [
    ['GGT', 'Gamma-glutamyl transferase', 'Blood (serum)', 12, 25000, [GGT]],
    ['ALP', 'Alkaline phosphatase', 'Blood (serum)', 12, 20000, [ALP]],
    [
      'BILI',
      'Bilirubin (total, direct and indirect)',
      'Blood (serum)',
      6,
      25000,
      [TBIL, DBIL, ['Indirect bilirubin', 'mg/dL', 0.2, 0.8]],
    ],
    [
      'PROT',
      'Total protein, albumin and globulin',
      'Blood (serum)',
      12,
      25000,
      [TPROT, ALB, ['Globulin', 'g/dL', 2, 3.5], ['A/G ratio', null, 1, 2.2]],
    ],
    ['AMYL', 'Amylase', 'Blood (serum)', 12, 40000, [['Amylase', 'U/L', 30, 110]]],
    ['LIPASE', 'Lipase', 'Blood (serum)', 12, 50000, [['Lipase', 'U/L', 13, 60]]],
    ['AMMONIA', 'Ammonia', 'Blood (EDTA, on ice)', 6, 80000, [['Ammonia', 'µmol/L', 11, 51]]],
  ],
  'Kidney function': [
    [
      'KFT',
      'Kidney function tests',
      'Blood (serum)',
      12,
      60000,
      [UREA, ['Blood urea nitrogen', 'mg/dL', 7, 20], CREAT, URIC, NA, K, CL],
    ],
    ['CREAT', 'Serum creatinine with eGFR', 'Blood (serum)', 6, 20000, [CREAT, EGFR]],
    ['UREA', 'Blood urea', 'Blood (serum)', 6, 15000, [UREA]],
    ['URIC', 'Uric acid', 'Blood (serum)', 6, 20000, [URIC]],
    [
      'UPCR',
      'Urine protein/creatinine ratio',
      'Urine (spot)',
      24,
      40000,
      [['Protein/creatinine ratio', 'mg/g', 0, 150]],
    ],
    [
      'U24P',
      '24-hour urine protein',
      'Urine (24-hour)',
      24,
      50000,
      [['Urine protein, 24 hours', 'mg/24 h', 0, 150]],
    ],
    ['CYSC', 'Cystatin C', 'Blood (serum)', 48, 150000, [['Cystatin C', 'mg/L', 0.6, 1]]],
  ],
  'Electrolytes, minerals and blood gas': [
    ['ELEC', 'Serum electrolytes', 'Blood (serum)', 4, 40000, [NA, K, CL, HCO3]],
    ['CA', 'Calcium, total', 'Blood (serum)', 6, 20000, [CA]],
    [
      'ICA',
      'Ionised calcium',
      'Blood (heparin)',
      6,
      40000,
      [['Ionised calcium', 'mmol/L', 1.12, 1.32]],
    ],
    ['PHOS', 'Phosphorus', 'Blood (serum)', 6, 20000, [['Phosphorus', 'mg/dL', 2.5, 4.5]]],
    ['MG', 'Magnesium', 'Blood (serum)', 6, 30000, [['Magnesium', 'mg/dL', 1.7, 2.2]]],
    [
      'ABG',
      'Arterial blood gas',
      'Blood (arterial, heparin)',
      1,
      120000,
      [
        ['pH', null, 7.35, 7.45],
        ['pCO2', 'mmHg', 35, 45],
        ['pO2', 'mmHg', 80, 100],
        ['HCO3', 'mmol/L', 22, 26],
        ['Base excess', 'mmol/L', -2, 2],
        ['Oxygen saturation', '%', 95, 100],
        ['Lactate', 'mmol/L', 0.5, 2.2],
      ],
    ],
  ],
  Thyroid: [
    [
      'TFT',
      'Thyroid profile (T3, T4, TSH)',
      'Blood (serum)',
      24,
      50000,
      [['Total T3', 'ng/dL', 80, 200], ['Total T4', 'µg/dL', 5.1, 14.1], TSH],
    ],
    ['FTFT', 'Free thyroid profile (FT3, FT4, TSH)', 'Blood (serum)', 24, 70000, [FT3, FT4, TSH]],
    ['TSH', 'Thyroid-stimulating hormone', 'Blood (serum)', 24, 30000, [TSH]],
    ['ATPO', 'Anti-TPO antibodies', 'Blood (serum)', 48, 90000, [['Anti-TPO', 'IU/mL', 0, 34]]],
  ],
  Hormones: [
    [
      'PRL',
      'Prolactin',
      'Blood (serum)',
      24,
      60000,
      [['Prolactin', 'ng/mL', null, null, 'Men 4–15; non-pregnant women 5–25']],
    ],
    [
      'LH',
      'Luteinising hormone',
      'Blood (serum)',
      24,
      50000,
      [['LH', 'mIU/mL', null, null, 'Men 1.7–8.6; women vary with cycle phase']],
    ],
    [
      'FSH',
      'Follicle-stimulating hormone',
      'Blood (serum)',
      24,
      50000,
      [['FSH', 'mIU/mL', null, null, 'Men 1.5–12.4; women vary with cycle phase']],
    ],
    [
      'TESTO',
      'Testosterone, total',
      'Blood (serum)',
      24,
      70000,
      [['Testosterone', 'ng/dL', null, null, 'Men 264–916; women 15–70']],
    ],
    [
      'E2',
      'Oestradiol',
      'Blood (serum)',
      24,
      70000,
      [['Oestradiol', 'pg/mL', null, null, 'Varies with sex and cycle phase']],
    ],
    [
      'PROG',
      'Progesterone',
      'Blood (serum)',
      24,
      70000,
      [['Progesterone', 'ng/mL', null, null, 'Varies with cycle phase and pregnancy']],
    ],
    [
      'BHCG',
      'Beta-hCG, quantitative',
      'Blood (serum)',
      6,
      60000,
      [['Beta-hCG', 'mIU/mL', null, 5, 'Below 5 when not pregnant']],
    ],
    ['CORT', 'Cortisol, morning', 'Blood (serum)', 24, 70000, [['Cortisol', 'µg/dL', 6.2, 19.4]]],
    [
      'AMH',
      'Anti-Müllerian hormone',
      'Blood (serum)',
      48,
      150000,
      [['AMH', 'ng/mL', null, null, 'Varies with age']],
    ],
    ['PTH', 'Parathyroid hormone, intact', 'Blood (serum)', 48, 120000, [['PTH', 'pg/mL', 15, 65]]],
    [
      'DHEAS',
      'DHEA sulphate',
      'Blood (serum)',
      48,
      90000,
      [['DHEA-S', 'µg/dL', null, null, 'Varies with age and sex']],
    ],
    [
      'GH',
      'Growth hormone',
      'Blood (serum)',
      48,
      90000,
      [['Growth hormone', 'ng/mL', null, null, 'Varies with age, sex and time of day']],
    ],
  ],
  'Cardiac markers': [
    [
      'TROP-I',
      'Troponin I, high-sensitivity',
      'Blood (serum)',
      2,
      120000,
      [['Troponin I', 'ng/L', 0, 26]],
    ],
    ['CKMB', 'CK-MB', 'Blood (serum)', 4, 60000, [['CK-MB', 'U/L', 0, 25]]],
    [
      'CPK',
      'Creatine kinase, total',
      'Blood (serum)',
      6,
      40000,
      [['Creatine kinase', 'U/L', 30, 200]],
    ],
    ['NTBNP', 'NT-proBNP', 'Blood (serum)', 6, 180000, [['NT-proBNP', 'pg/mL', 0, 125]]],
    ['LDH', 'Lactate dehydrogenase', 'Blood (serum)', 6, 35000, [['LDH', 'U/L', 140, 280]]],
    ['HSCRP', 'High-sensitivity CRP', 'Blood (serum)', 24, 60000, [HSCRP]],
    ['HCY', 'Homocysteine', 'Blood (serum)', 48, 100000, [['Homocysteine', 'µmol/L', 5, 15]]],
  ],
  'Inflammation and immunology': [
    ['CRP', 'C-reactive protein', 'Blood (serum)', 4, 40000, [CRP]],
    [
      'RA',
      'Rheumatoid factor',
      'Blood (serum)',
      24,
      40000,
      [['Rheumatoid factor', 'IU/mL', 0, 14]],
    ],
    ['ACCP', 'Anti-CCP antibodies', 'Blood (serum)', 48, 120000, [['Anti-CCP', 'U/mL', 0, 17]]],
    ['ANA', 'Antinuclear antibodies (IFA)', 'Blood (serum)', 72, 120000, [NEG('ANA')]],
    ['ASO', 'Anti-streptolysin O', 'Blood (serum)', 24, 40000, [['ASO titre', 'IU/mL', 0, 200]]],
    ['PCT', 'Procalcitonin', 'Blood (serum)', 6, 200000, [['Procalcitonin', 'ng/mL', 0, 0.5]]],
    ['IGE', 'Total IgE', 'Blood (serum)', 48, 80000, [['Total IgE', 'IU/mL', 0, 100]]],
    ['HLAB27', 'HLA-B27 (PCR)', 'Blood (EDTA)', 72, 250000, [NEG('HLA-B27')]],
  ],
  'Vitamins and iron': [
    ['VITD', 'Vitamin D (25-hydroxy)', 'Blood (serum)', 24, 120000, [VITD]],
    ['VITB12', 'Vitamin B12', 'Blood (serum)', 24, 90000, [B12]],
    ['FOLATE', 'Folate', 'Blood (serum)', 24, 80000, [['Folate', 'ng/mL', 3, 17]]],
    [
      'IRON',
      'Iron studies',
      'Blood (serum)',
      24,
      80000,
      [IRON, ['TIBC', 'µg/dL', 240, 450], ['Transferrin saturation', '%', 20, 50]],
    ],
    ['FERR', 'Ferritin', 'Blood (serum)', 24, 60000, [FERRITIN]],
  ],
  'Infections and serology': [
    ['HIV', 'HIV 1 and 2 antibodies', 'Blood (serum)', 24, 50000, [HIV]],
    ['HBSAG', 'Hepatitis B surface antigen', 'Blood (serum)', 24, 40000, [HBSAG]],
    ['HCV', 'Hepatitis C antibodies', 'Blood (serum)', 24, 60000, [HCV]],
    ['HAV', 'Hepatitis A IgM', 'Blood (serum)', 24, 70000, [NONREACTIVE('Hepatitis A IgM')]],
    ['HEV', 'Hepatitis E IgM', 'Blood (serum)', 24, 80000, [NONREACTIVE('Hepatitis E IgM')]],
    ['VDRL', 'VDRL (syphilis screen)', 'Blood (serum)', 24, 25000, [VDRL]],
    [
      'WIDAL',
      'Widal test',
      'Blood (serum)',
      24,
      25000,
      [
        TEXT('S. typhi O', 'Below 1:80'),
        TEXT('S. typhi H', 'Below 1:160'),
        TEXT('S. paratyphi AH', 'Below 1:80'),
        TEXT('S. paratyphi BH', 'Below 1:80'),
      ],
    ],
    ['TYPHI-IGM', 'Typhoid IgM (rapid)', 'Blood (serum)', 4, 60000, [NEG('Typhoid IgM')]],
    [
      'DENGUE',
      'Dengue NS1 antigen with IgM and IgG',
      'Blood (serum)',
      6,
      90000,
      [NS1, DEN_IGM, NEG('Dengue IgG')],
    ],
    ['CHIK', 'Chikungunya IgM', 'Blood (serum)', 24, 60000, [NEG('Chikungunya IgM')]],
    ['LEPTO', 'Leptospira IgM', 'Blood (serum)', 24, 70000, [NEG('Leptospira IgM')]],
    ['SCRUB', 'Scrub typhus IgM', 'Blood (serum)', 24, 70000, [NEG('Scrub typhus IgM')]],
    [
      'COVID-PCR',
      'SARS-CoV-2 RT-PCR',
      'Nasopharyngeal swab',
      24,
      50000,
      [TEXT('SARS-CoV-2 RNA', 'Not detected')],
    ],
    [
      'FLU',
      'Influenza A and B antigen',
      'Nasal swab',
      2,
      80000,
      [NEG('Influenza A antigen'), NEG('Influenza B antigen')],
    ],
    ['HPYLORI', 'H. pylori stool antigen', 'Stool', 24, 80000, [NEG('H. pylori antigen')]],
    [
      'IGRA',
      'Interferon-gamma release assay (TB)',
      'Blood (heparin)',
      72,
      250000,
      [NEG('IGRA result')],
    ],
    [
      'TORCH',
      'TORCH IgM panel',
      'Blood (serum)',
      48,
      200000,
      [
        NEG('Toxoplasma IgM'),
        NEG('Rubella IgM'),
        NEG('Cytomegalovirus IgM'),
        NEG('Herpes simplex 1 and 2 IgM'),
      ],
    ],
  ],
  'Urine tests': [
    [
      'URINE-RE',
      'Urine routine and microscopy',
      'Urine (midstream)',
      2,
      15000,
      [
        TEXT('Colour', 'Pale yellow'),
        TEXT('Appearance', 'Clear'),
        ['Specific gravity', null, 1.005, 1.03],
        ['pH', null, 4.5, 8],
        U_PROT,
        U_GLU,
        NEG('Ketones'),
        NEG('Blood'),
        NEG('Bilirubin'),
        TEXT('Urobilinogen', 'Normal'),
        NEG('Nitrite'),
        NEG('Leucocyte esterase'),
        U_PUS,
        U_RBC,
        ['Epithelial cells', '/HPF', 0, 5],
        TEXT('Casts', 'None seen'),
        TEXT('Crystals', 'None seen'),
      ],
    ],
    [
      'UPT',
      'Urine pregnancy test',
      'Urine (first morning)',
      1,
      10000,
      [TEXT('Urine hCG', 'Negative when not pregnant')],
    ],
    ['UKET', 'Urine ketones', 'Urine (spot)', 1, 8000, [NEG('Ketones')]],
    [
      'URINE-CS',
      'Urine culture and sensitivity',
      'Urine (midstream, sterile)',
      72,
      60000,
      [
        TEXT('Organism', 'No growth'),
        TEXT('Colony count', 'Below 10^5 CFU/mL'),
        TEXT('Antibiotic sensitivity', 'Reported when there is growth'),
      ],
    ],
    [
      'UDS',
      'Urine drug screen',
      'Urine (spot)',
      6,
      150000,
      [
        NEG('Amphetamines'),
        NEG('Benzodiazepines'),
        NEG('Cannabinoids'),
        NEG('Cocaine'),
        NEG('Opiates'),
      ],
    ],
  ],
  'Stool tests': [
    [
      'STOOL-RE',
      'Stool routine and microscopy',
      'Stool',
      6,
      15000,
      [
        TEXT('Colour', 'Brown'),
        TEXT('Consistency', 'Formed'),
        TEXT('Mucus', 'Absent'),
        TEXT('Visible blood', 'Absent'),
        TEXT('Ova and cysts', 'Not seen'),
        ['Pus cells', '/HPF', 0, 5],
      ],
    ],
    ['FOBT', 'Faecal occult blood', 'Stool', 6, 20000, [NEG('Occult blood')]],
    [
      'STOOL-CS',
      'Stool culture and sensitivity',
      'Stool',
      72,
      70000,
      [
        TEXT('Organism', 'No pathogens isolated'),
        TEXT('Antibiotic sensitivity', 'Reported when there is growth'),
      ],
    ],
  ],
  Microbiology: [
    [
      'BLOOD-CS',
      'Blood culture and sensitivity',
      'Blood (culture bottle)',
      120,
      120000,
      [
        TEXT('Organism', 'No growth after 5 days'),
        TEXT('Antibiotic sensitivity', 'Reported when there is growth'),
      ],
    ],
    [
      'SPUTUM-CS',
      'Sputum culture and sensitivity',
      'Sputum',
      72,
      70000,
      [
        TEXT('Organism', 'Normal flora only'),
        TEXT('Antibiotic sensitivity', 'Reported when there is growth'),
      ],
    ],
    [
      'PUS-CS',
      'Pus culture and sensitivity',
      'Pus swab',
      72,
      70000,
      [
        TEXT('Organism', 'No growth'),
        TEXT('Antibiotic sensitivity', 'Reported when there is growth'),
      ],
    ],
    ['AFB', 'Sputum AFB smear', 'Sputum', 24, 20000, [TEXT('Acid-fast bacilli', 'Not seen')]],
    [
      'CBNAAT',
      'TB and rifampicin resistance (CBNAAT)',
      'Sputum',
      24,
      250000,
      [TEXT('M. tuberculosis', 'Not detected'), TEXT('Rifampicin resistance', 'Not detected')],
    ],
    [
      'GRAM',
      'Gram stain',
      'Swab or body fluid',
      4,
      15000,
      [TEXT('Gram stain', 'No organisms seen')],
    ],
    [
      'KOH',
      'KOH mount for fungi',
      'Skin, hair or nail scraping',
      4,
      20000,
      [TEXT('Fungal elements', 'Not seen')],
    ],
  ],
  'Tumour markers': [
    [
      'PSA',
      'Prostate-specific antigen, total',
      'Blood (serum)',
      24,
      70000,
      [['PSA', 'ng/mL', 0, 4]],
    ],
    ['CEA', 'Carcinoembryonic antigen', 'Blood (serum)', 24, 80000, [['CEA', 'ng/mL', 0, 5]]],
    ['CA125', 'CA-125', 'Blood (serum)', 24, 100000, [['CA-125', 'U/mL', 0, 35]]],
    ['CA199', 'CA 19-9', 'Blood (serum)', 24, 100000, [['CA 19-9', 'U/mL', 0, 37]]],
    ['CA153', 'CA 15-3', 'Blood (serum)', 24, 100000, [['CA 15-3', 'U/mL', 0, 30]]],
    ['AFP', 'Alpha-fetoprotein', 'Blood (serum)', 24, 80000, [['AFP', 'ng/mL', 0, 10]]],
  ],
  'Body fluids and pathology': [
    [
      'SEMEN',
      'Semen analysis',
      'Semen',
      6,
      50000,
      [
        ['Volume', 'mL', 1.5, null],
        ['Sperm concentration', 'million/mL', 15, null],
        ['Total motility', '%', 40, null],
        ['Progressive motility', '%', 32, null],
        ['Normal forms', '%', 4, null],
        ['pH', null, 7.2, 8],
      ],
    ],
    [
      'CSF',
      'CSF analysis',
      'Cerebrospinal fluid',
      6,
      80000,
      [
        ['CSF glucose', 'mg/dL', 40, 70],
        ['CSF protein', 'mg/dL', 15, 45],
        ['CSF cell count', 'cells/µL', 0, 5],
        TEXT('CSF Gram stain', 'No organisms seen'),
      ],
    ],
    [
      'FLUID',
      'Pleural or ascitic fluid analysis',
      'Pleural or ascitic fluid',
      12,
      80000,
      [
        ['Fluid protein', 'g/dL', null, null, 'Compare with serum protein'],
        ['Fluid glucose', 'mg/dL', null, null, 'Compare with blood glucose'],
        ['Fluid LDH', 'U/L', null, null, 'Compare with serum LDH'],
        ['Fluid cell count', 'cells/µL', null, null, 'Interpreted by the pathologist'],
      ],
    ],
    [
      'PAP',
      'Pap smear (cervical cytology)',
      'Cervical smear',
      120,
      80000,
      [TEXT('Cytology result', 'Negative for intraepithelial lesion or malignancy')],
    ],
    [
      'FNAC',
      'Fine-needle aspiration cytology',
      'Aspirate (slides)',
      72,
      120000,
      [TEXT('Cytology report', 'Reported by the pathologist')],
    ],
    [
      'HISTO',
      'Histopathology, small biopsy',
      'Tissue (formalin)',
      168,
      150000,
      [TEXT('Histopathology report', 'Reported by the pathologist')],
    ],
  ],
  'Health checkup packages': [
    [
      'HC-BASIC',
      'Basic health checkup',
      'Blood and urine',
      24,
      150000,
      [
        HB,
        WBC,
        PLT,
        ESR,
        GLU_F,
        CHOL,
        TG,
        HDL,
        LDL,
        UREA,
        CREAT,
        URIC,
        ALT,
        AST,
        TBIL,
        TSH,
        U_PROT,
        U_GLU,
      ],
    ],
    [
      'HC-FULL',
      'Full body checkup',
      'Blood and urine',
      48,
      450000,
      [
        HB,
        WBC,
        PLT,
        ESR,
        GLU_F,
        HBA1C,
        CHOL,
        TG,
        HDL,
        LDL,
        VLDL,
        UREA,
        CREAT,
        EGFR,
        URIC,
        NA,
        K,
        CL,
        CA,
        ALT,
        AST,
        ALP,
        GGT,
        TBIL,
        TPROT,
        ALB,
        FT3,
        FT4,
        TSH,
        VITD,
        B12,
        IRON,
        FERRITIN,
        HSCRP,
        U_PROT,
        U_GLU,
        U_PUS,
        U_RBC,
      ],
    ],
    [
      'HC-DIABETES',
      'Diabetes care panel',
      'Blood and urine',
      24,
      200000,
      [GLU_F, GLU_PP, HBA1C, CHOL, TG, HDL, LDL, CREAT, EGFR, K, UACR],
    ],
    [
      'HC-HEART',
      'Heart health panel',
      'Blood (serum and EDTA)',
      48,
      250000,
      [
        CHOL,
        TG,
        HDL,
        LDL,
        ['Lipoprotein(a)', 'mg/dL', 0, 30],
        ['Apolipoprotein B', 'mg/dL', 55, 140],
        HSCRP,
        ['Homocysteine', 'µmol/L', 5, 15],
        GLU_F,
        HBA1C,
      ],
    ],
    [
      'HC-WOMEN',
      "Women's wellness panel",
      'Blood and urine',
      48,
      350000,
      [HB, PLT, FERRITIN, VITD, B12, CA, TSH, FT4, GLU_F, HBA1C, CHOL, CREAT, U_PROT, U_PUS],
    ],
    [
      'HC-SENIOR',
      'Senior citizen health checkup',
      'Blood and urine',
      48,
      400000,
      [
        HB,
        WBC,
        PLT,
        ESR,
        GLU_F,
        HBA1C,
        CHOL,
        TG,
        HDL,
        LDL,
        UREA,
        CREAT,
        EGFR,
        NA,
        K,
        CA,
        ALT,
        AST,
        ALB,
        TSH,
        VITD,
        B12,
        U_PROT,
        U_GLU,
        U_PUS,
      ],
    ],
    [
      'HC-PREOP',
      'Pre-operative profile',
      'Blood (EDTA, citrate, serum)',
      24,
      150000,
      [HB, WBC, PLT, PT, INR, APTT, GLU_R, UREA, CREAT, NA, K, ABO, RH, HIV, HBSAG, HCV],
    ],
    [
      'HC-FEVER',
      'Fever panel',
      'Blood and urine',
      24,
      180000,
      [
        HB,
        WBC,
        PLT,
        MP_SMEAR,
        NS1,
        DEN_IGM,
        TEXT('S. typhi O', 'Below 1:80'),
        TEXT('S. typhi H', 'Below 1:160'),
        CRP,
        U_PUS,
      ],
    ],
    [
      'HC-ANTENATAL',
      'Antenatal profile',
      'Blood and urine',
      48,
      250000,
      [
        HB,
        ABO,
        RH,
        GLU_F,
        TSH,
        HIV,
        HBSAG,
        HCV,
        VDRL,
        ['Rubella IgG', null, null, null, 'Immune or non-immune'],
        U_PROT,
        U_GLU,
      ],
    ],
  ],
};

const DEPARTMENT_NAMES: Record<string, string> = Object.fromEntries([
  ...DEMO_DEPARTMENTS.map((d) => [d.code, d.name]),
  ...SPECIALIST_DEPARTMENTS,
]);

/** The catalogue, flattened: general groups, then each department's own diagnostics. */
export const DEMO_LAB_CATALOGUE: DemoLabTest[] = Object.entries({
  ...CLASSES,
  ...Object.fromEntries(
    Object.entries(DEPARTMENT_DIAGNOSTICS).map(([dept, rows]) => [
      `${DEPARTMENT_NAMES[dept] ?? dept} diagnostics`,
      rows,
    ]),
  ),
}).flatMap(([category, rows]) =>
  rows.map(([code, name, sample, turnaroundHours, pricePaise, params]) => ({
    code,
    name,
    sample,
    turnaroundHours,
    pricePaise,
    params,
    category,
  })),
);

export interface DemoLabTestsResult {
  tests: number;
  parameters: number;
  /** Tests left alone because their code or LAB-<code> price-list entry already exists. */
  skipped: number;
  /** Price-list entries newly linked to their department (only entries with none yet). */
  linkedToDepartments: number;
}

export async function seedDemoLabTests(db: Queryable): Promise<DemoLabTestsResult> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
  const r: DemoLabTestsResult = { tests: 0, parameters: 0, skipped: 0, linkedToDepartments: 0 };

  for (const t of DEMO_LAB_CATALOGUE) {
    const serviceCode = `LAB-${t.code}`;
    const { rowCount } = await db.query(
      `SELECT 1 FROM lab_tests WHERE code = $1
       UNION ALL SELECT 1 FROM service_catalogue WHERE code = $2`,
      [t.code, serviceCode],
    );
    if (rowCount) {
      r.skipped += 1;
      continue;
    }
    const { rows: svc } = await db.query<{ id: string }>(
      `INSERT INTO service_catalogue (code, name, kind, price_paise) VALUES ($1, $2, 'lab', $3) RETURNING id`,
      [serviceCode, t.name, t.pricePaise],
    );
    const { rows: test } = await db.query<{ id: string }>(
      'INSERT INTO lab_tests (code, name, sample_type, service_id, turnaround_hours) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [t.code, t.name, t.sample, svc[0]!.id, t.turnaroundHours],
    );
    for (const [i, [name, unit, low, high, text]] of t.params.entries()) {
      await db.query(
        `INSERT INTO lab_test_parameters (test_id, name, unit, ref_low, ref_high, ref_text, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [test[0]!.id, name, unit, low, high, text ?? null, i],
      );
      r.parameters += 1;
    }
    r.tests += 1;
  }

  // Link tests to their department. Only empty links are filled, so a department chosen by
  // hand is never overwritten; departments that don't exist yet are simply skipped.
  const links = Object.entries(TEST_DEPARTMENTS);
  r.linkedToDepartments =
    (
      await db.query(
        `UPDATE service_catalogue s SET department_id = d.id
           FROM unnest($1::text[], $2::text[]) AS t(code, dept)
           JOIN departments d ON d.code = t.dept AND d.is_clinical
          WHERE s.code = 'LAB-' || t.code AND s.kind = 'lab' AND s.department_id IS NULL`,
        [links.map(([code]) => code), links.map(([, dept]) => dept)],
      )
    ).rowCount ?? 0;

  if (r.tests > 0 || r.linkedToDepartments > 0) {
    await recordAudit(
      db,
      {
        actor: SYSTEM,
        action: 'demo_seed.lab_tests_applied',
        entityType: 'system',
        changes: { ...r },
      },
      { requestId: null, ip: null },
    );
  }
  return r;
}
