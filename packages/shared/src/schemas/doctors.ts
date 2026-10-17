export interface Department {
  id: string;
  code: string;
  name: string;
  isClinical: boolean;
}

export interface DoctorListItem {
  id: string;
  fullName: string;
  departmentId: string;
  departmentName: string;
  specialty: string;
  defaultSlotMinutes: number;
  consultationFeePaise: number;
}
