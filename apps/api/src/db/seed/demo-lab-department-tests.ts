/**
 * Department diagnostics for the demo lab catalogue, and which department each test belongs to.
 *
 * DEPARTMENT_DIAGNOSTICS are the tests a department runs on the patient in person (ECG and
 * echo for cardiology, audiometry for ENT, visual acuity for eye, PHQ-9 for psychiatry, …).
 * They are recorded like any lab test: a technician enters the readings or findings and
 * another verifies them. Imaging here is a findings report only; there is no image storage.
 *
 * TEST_DEPARTMENTS links tests (new and existing) to a department through their price-list
 * entry, so a doctor sees their own department's tests first. Tests not listed stay general
 * (every department). Reference values are typical adult demo values, not clinical guidance.
 */
import type { LabParam, LabTestRow } from './demo-lab-tests.js';

const IN_PERSON = 'Patient (in person)';
const TEXT = (name: string, text: string): LabParam => [name, null, null, null, text];
const FINDINGS = TEXT('Findings', 'Reported by the specialist');
const IMPRESSION = TEXT('Impression', 'Normal study');

/** Department code → its in-person diagnostic tests. */
export const DEPARTMENT_DIAGNOSTICS: Record<string, LabTestRow[]> = {
  CARDIO: [
    [
      'ECG',
      'Electrocardiogram (12-lead ECG)',
      IN_PERSON,
      1,
      30000,
      [
        TEXT('Rhythm', 'Sinus rhythm'),
        ['Heart rate', 'beats/min', 60, 100],
        ['PR interval', 'ms', 120, 200],
        ['QRS duration', 'ms', 80, 120],
        ['QTc', 'ms', 350, 450],
        IMPRESSION,
      ],
    ],
    [
      'ECHO',
      '2D echocardiography',
      IN_PERSON,
      24,
      200000,
      [
        ['LV ejection fraction', '%', 55, 70],
        TEXT('Valves', 'Normal'),
        TEXT('Regional wall motion', 'No abnormality'),
        IMPRESSION,
      ],
    ],
    [
      'TMT',
      'Treadmill stress test',
      IN_PERSON,
      24,
      150000,
      [
        ['Exercise capacity', 'METs', 10, null],
        ['Target heart rate achieved', '%', 85, null],
        TEXT('Result', 'Negative for inducible ischaemia'),
      ],
    ],
    [
      'HOLTER',
      'Holter monitoring (24 hours)',
      IN_PERSON,
      48,
      250000,
      [
        ['Average heart rate', 'beats/min', 60, 100],
        TEXT('Arrhythmias', 'None significant'),
        IMPRESSION,
      ],
    ],
  ],
  NEURO: [
    [
      'EEG',
      'Electroencephalogram (EEG)',
      IN_PERSON,
      24,
      200000,
      [
        TEXT('Background activity', 'Normal for age'),
        TEXT('Epileptiform activity', 'None'),
        IMPRESSION,
      ],
    ],
    ['NCV', 'Nerve conduction study', IN_PERSON, 24, 300000, [FINDINGS, IMPRESSION]],
    ['EMG', 'Electromyography (EMG)', IN_PERSON, 24, 300000, [FINDINGS, IMPRESSION]],
  ],
  PULMO: [
    [
      'PFT',
      'Pulmonary function test (spirometry)',
      IN_PERSON,
      2,
      100000,
      [
        ['FEV1', '% predicted', 80, null],
        ['FVC', '% predicted', 80, null],
        ['FEV1/FVC ratio', null, 0.7, null],
        TEXT('Pattern', 'Normal'),
      ],
    ],
    [
      '6MWT',
      'Six-minute walk test',
      IN_PERSON,
      1,
      50000,
      [
        ['Distance walked', 'm', 400, null],
        ['Lowest SpO2', '%', 90, null],
      ],
    ],
  ],
  GASTRO: [
    [
      'UGIE',
      'Upper GI endoscopy',
      IN_PERSON,
      24,
      300000,
      [FINDINGS, TEXT('Biopsy taken', 'No'), IMPRESSION],
    ],
    [
      'COLONO',
      'Colonoscopy',
      IN_PERSON,
      24,
      500000,
      [FINDINGS, TEXT('Biopsy taken', 'No'), IMPRESSION],
    ],
    [
      'FIBROSCAN',
      'Liver FibroScan',
      IN_PERSON,
      2,
      250000,
      [
        ['Liver stiffness', 'kPa', 2, 7],
        ['Controlled attenuation parameter', 'dB/m', null, 248],
      ],
    ],
    ['USG-ABD', 'Ultrasound abdomen', IN_PERSON, 4, 120000, [FINDINGS, IMPRESSION]],
  ],
  NEPHRO: [
    [
      'USG-KUB',
      'Ultrasound kidneys, ureters and bladder',
      IN_PERSON,
      4,
      100000,
      [['Right kidney length', 'cm', 9, 12], ['Left kidney length', 'cm', 9, 12], IMPRESSION],
    ],
    [
      'U-ELEC',
      'Urine sodium and potassium',
      'Urine (spot)',
      12,
      40000,
      [
        ['Urine sodium', 'mmol/L', null, null, 'Interpret with serum values'],
        ['Urine potassium', 'mmol/L', null, null, 'Interpret with serum values'],
      ],
    ],
  ],
  ENDO: [
    [
      'HOMA-IR',
      'Insulin resistance (HOMA-IR)',
      'Blood (serum, fasting)',
      24,
      90000,
      [
        ['Fasting glucose', 'mg/dL', 70, 100],
        ['Fasting insulin', 'µIU/mL', 2.6, 24.9],
        ['HOMA-IR', null, null, 2.5],
      ],
    ],
    ['USG-THY', 'Ultrasound thyroid', IN_PERSON, 4, 100000, [FINDINGS, IMPRESSION]],
  ],
  OBGYN: [
    [
      'USG-OBS',
      'Obstetric ultrasound',
      IN_PERSON,
      4,
      150000,
      [
        ['Gestational age', 'weeks', null, null, 'As per dates'],
        ['Fetal heart rate', 'beats/min', 110, 160],
        TEXT('Placenta', 'Normal position'),
        TEXT('Amniotic fluid', 'Adequate'),
      ],
    ],
    [
      'NST',
      'Non-stress test (fetal monitoring)',
      IN_PERSON,
      1,
      60000,
      [
        ['Baseline fetal heart rate', 'beats/min', 110, 160],
        TEXT('Variability', 'Normal (5–25 bpm)'),
        TEXT('Result', 'Reactive'),
      ],
    ],
    [
      'DUAL-MARKER',
      'Double marker screen',
      'Blood (serum)',
      72,
      250000,
      [TEXT('Risk', 'Low risk')],
    ],
    ['USG-PELVIS', 'Ultrasound pelvis', IN_PERSON, 4, 120000, [FINDINGS, IMPRESSION]],
    [
      'MAMMO',
      'Mammography (findings report)',
      IN_PERSON,
      24,
      200000,
      [TEXT('BI-RADS category', '1 or 2'), IMPRESSION],
    ],
  ],
  OPHTHAL: [
    [
      'VA',
      'Visual acuity',
      IN_PERSON,
      1,
      10000,
      [TEXT('Right eye', '6/6'), TEXT('Left eye', '6/6')],
    ],
    [
      'IOP',
      'Tonometry (eye pressure)',
      IN_PERSON,
      1,
      20000,
      [
        ['Right eye pressure', 'mmHg', 10, 21],
        ['Left eye pressure', 'mmHg', 10, 21],
      ],
    ],
    [
      'REFRACT',
      'Refraction (spectacle power)',
      IN_PERSON,
      1,
      30000,
      [
        TEXT('Right eye', 'Reported by the optometrist'),
        TEXT('Left eye', 'Reported by the optometrist'),
      ],
    ],
    ['FUNDUS', 'Fundus examination', IN_PERSON, 1, 30000, [FINDINGS, IMPRESSION]],
    ['OCT', 'Optical coherence tomography (OCT)', IN_PERSON, 24, 200000, [FINDINGS, IMPRESSION]],
    ['COLOUR-VISION', 'Colour vision test', IN_PERSON, 1, 10000, [TEXT('Result', 'Normal')]],
  ],
  ENT: [
    [
      'PTA',
      'Pure tone audiometry',
      IN_PERSON,
      2,
      60000,
      [
        ['Right ear hearing threshold', 'dB HL', 0, 25],
        ['Left ear hearing threshold', 'dB HL', 0, 25],
        IMPRESSION,
      ],
    ],
    [
      'TYMPANO',
      'Tympanometry',
      IN_PERSON,
      2,
      50000,
      [TEXT('Right ear', 'Type A'), TEXT('Left ear', 'Type A')],
    ],
    ['NASAL-ENDO', 'Diagnostic nasal endoscopy', IN_PERSON, 2, 150000, [FINDINGS, IMPRESSION]],
  ],
  PSYCH: [
    ['PHQ9', 'Depression screen (PHQ-9)', IN_PERSON, 1, 20000, [['PHQ-9 score', 'points', 0, 4]]],
    ['GAD7', 'Anxiety screen (GAD-7)', IN_PERSON, 1, 20000, [['GAD-7 score', 'points', 0, 4]]],
    ['MMSE', 'Memory test (MMSE)', IN_PERSON, 1, 30000, [['MMSE score', 'points', 24, 30]]],
  ],
  URO: [
    [
      'UROFLOW',
      'Uroflowmetry',
      IN_PERSON,
      1,
      80000,
      [
        ['Peak flow rate (Qmax)', 'mL/s', 15, null],
        ['Voided volume', 'mL', 150, null],
        ['Post-void residual', 'mL', 0, 50],
      ],
    ],
  ],
  ONCO: [
    [
      'BMA',
      'Bone marrow aspiration and biopsy',
      'Bone marrow',
      120,
      500000,
      [FINDINGS, IMPRESSION],
    ],
  ],
  GEN_SURG: [
    ['USG-SOFT', 'Ultrasound soft tissue / swelling', IN_PERSON, 4, 100000, [FINDINGS, IMPRESSION]],
  ],
  DENTAL: [
    ['OPG', 'Panoramic dental X-ray (OPG)', IN_PERSON, 2, 40000, [FINDINGS, IMPRESSION]],
    ['IOPA', 'Intraoral dental X-ray (IOPA)', IN_PERSON, 1, 15000, [FINDINGS]],
  ],
  PHYSIO: [
    [
      'ROM',
      'Range of motion assessment',
      IN_PERSON,
      1,
      30000,
      [TEXT('Affected joint', 'Full range'), FINDINGS],
    ],
    ['MRC', 'Muscle strength grading (MRC)', IN_PERSON, 1, 30000, [TEXT('Grade', '5/5 (normal)')]],
  ],
  EMERG: [
    [
      'LACTATE',
      'Blood lactate',
      'Blood (arterial or venous)',
      1,
      50000,
      [['Lactate', 'mmol/L', 0.5, 2.2]],
    ],
    ['GCS', 'Glasgow Coma Scale', IN_PERSON, 1, 5000, [['GCS total', 'points', 15, 15]]],
  ],
  ORTHO: [
    ['XRAY', 'X-ray, one region (findings report)', IN_PERSON, 2, 40000, [FINDINGS, IMPRESSION]],
    [
      'DEXA',
      'Bone density scan (DEXA)',
      IN_PERSON,
      24,
      200000,
      [['T-score (lowest site)', null, -1, null], IMPRESSION],
    ],
  ],
  DERM: [
    [
      'PATCH',
      'Patch test (contact allergy)',
      IN_PERSON,
      72,
      150000,
      [TEXT('Result', 'No reaction')],
    ],
    ['WOODS', "Wood's lamp examination", IN_PERSON, 1, 20000, [FINDINGS]],
    [
      'SKIN-BX',
      'Skin biopsy',
      'Tissue (formalin)',
      168,
      150000,
      [TEXT('Histopathology report', 'Reported by the pathologist')],
    ],
  ],
  PAED: [
    [
      'NBS',
      'Newborn screening panel',
      'Blood (heel prick, dried spot)',
      72,
      150000,
      [
        ['Neonatal TSH', 'mIU/L', null, 10],
        TEXT('G6PD', 'Normal'),
        ['17-OH progesterone', 'ng/mL', null, null, 'Varies with birth weight'],
        TEXT('Galactosaemia screen', 'Negative'),
      ],
    ],
    [
      'NNBILI',
      'Neonatal bilirubin',
      'Blood (heel prick)',
      2,
      25000,
      [['Total bilirubin', 'mg/dL', null, null, 'Plot on the age-in-hours chart']],
    ],
  ],
};

/** Existing catalogue tests that belong to one department (the rest stay general). */
const EXISTING: Record<string, string[]> = {
  CARDIO: ['LIPID', 'APO', 'LPA', 'TROP-I', 'CKMB', 'CPK', 'NTBNP', 'HSCRP', 'HCY', 'HC-HEART'],
  NEURO: ['CSF'],
  PULMO: ['ABG', 'AFB', 'CBNAAT', 'SPUTUM-CS', 'IGRA'],
  GASTRO: [
    'LFT',
    'GGT',
    'ALP',
    'BILI',
    'PROT',
    'AMYL',
    'LIPASE',
    'AMMONIA',
    'HPYLORI',
    'HAV',
    'HEV',
    'STOOL-RE',
    'FOBT',
    'STOOL-CS',
    'FLUID',
  ],
  NEPHRO: ['KFT', 'CREAT', 'UREA', 'UPCR', 'U24P', 'CYSC', 'UMALB'],
  ENDO: [
    'TFT',
    'FTFT',
    'TSH',
    'ATPO',
    'HBA1C',
    'OGTT',
    'INSULIN',
    'CPEP',
    'CORT',
    'PTH',
    'DHEAS',
    'GH',
    'HC-DIABETES',
  ],
  OBGYN: [
    'BHCG',
    'UPT',
    'PRL',
    'LH',
    'FSH',
    'E2',
    'PROG',
    'AMH',
    'TORCH',
    'PAP',
    'HC-ANTENATAL',
    'HC-WOMEN',
  ],
  URO: ['PSA', 'SEMEN', 'TESTO', 'URINE-CS'],
  ONCO: ['CEA', 'CA125', 'CA199', 'CA153', 'AFP', 'FNAC', 'HISTO'],
  GEN_SURG: ['HC-PREOP', 'PUS-CS', 'BT-CT'],
  EMERG: ['DDIMER', 'PCT', 'ELEC', 'UDS', 'BLOOD-CS'],
  ORTHO: ['RA', 'ACCP', 'HLAB27', 'URIC', 'VITD'],
  DERM: ['KOH', 'IGE', 'ANA'],
  PAED: ['HB-HPLC', 'SICKLE', 'G6PD'],
  GEN_MED: ['HC-BASIC', 'HC-FULL', 'HC-SENIOR', 'HC-FEVER', 'DENGUE', 'MP', 'WIDAL', 'TYPHI-IGM'],
};

/** Test code → department code, for the department diagnostics and the existing tests. */
export const TEST_DEPARTMENTS: Record<string, string> = Object.fromEntries([
  ...Object.entries(DEPARTMENT_DIAGNOSTICS).flatMap(([dept, rows]) =>
    rows.map(([code]) => [code, dept]),
  ),
  ...Object.entries(EXISTING).flatMap(([dept, codes]) => codes.map((code) => [code, dept])),
]);
