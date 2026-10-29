import { supabaseAdmin } from '../config/supabase.js';
import { EmployeeInfo, UserRole } from '../types/auth.types.js';

export class ProfileUnavailable extends Error {}

export async function loadProfileDetails(userId: string, role: UserRole, branchId: string | null) {
    // Branch info
    let branchName: string | null = null;
    if (branchId) {
      const { data: bData, error: branchError } = await supabaseAdmin
        .from('branches')
        .select('name')
        .eq('id', branchId)
        .single();
      if (branchError) throw new ProfileUnavailable();
      branchName = bData?.name || null;
    }

    // Employee info if role is NV
    let employeeInfo: EmployeeInfo | null = null;
    if (role === 'NV') {
      const { data: empData, error: employeeError } = await supabaseAdmin
        .from('employees')
        .select('id, full_name, skill_level, department_id, phone, departments:department_id(name)')
        .eq('user_id', userId)
        .maybeSingle();

      if (employeeError) throw new ProfileUnavailable();
      if (empData) {
        const dept = empData.departments as any;
        employeeInfo = {
          id: empData.id,
          full_name: empData.full_name,
          skill_level: empData.skill_level,
          department_id: empData.department_id,
          department_name: dept?.name || undefined,
          phone: empData.phone || undefined,
        };
      }
    }

    return { branchName, employeeInfo };
}
