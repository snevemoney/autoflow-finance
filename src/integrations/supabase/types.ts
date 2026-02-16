export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      applicant_debts: {
        Row: {
          created_at: string
          created_by: string | null
          creditor_name: string
          customer_id: string
          deal_id: string
          debt_type: Database["public"]["Enums"]["debt_type"]
          id: string
          is_court_ordered: boolean
          monthly_payment: number
          months_remaining: number | null
          notes: string | null
          total_balance: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          creditor_name: string
          customer_id: string
          deal_id: string
          debt_type: Database["public"]["Enums"]["debt_type"]
          id?: string
          is_court_ordered?: boolean
          monthly_payment: number
          months_remaining?: number | null
          notes?: string | null
          total_balance?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          creditor_name?: string
          customer_id?: string
          deal_id?: string
          debt_type?: Database["public"]["Enums"]["debt_type"]
          id?: string
          is_court_ordered?: boolean
          monthly_payment?: number
          months_remaining?: number | null
          notes?: string | null
          total_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "applicant_debts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applicant_debts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          city: string | null
          created_at: string
          date_of_birth: string | null
          email: string
          employer: string | null
          employer_verification_data: Json | null
          employer_verified: boolean | null
          first_name: string
          id: string
          job_title: string | null
          last_name: string
          monthly_income: number | null
          phone: string
          ssn: string | null
          state: string | null
          street: string | null
          updated_at: string
          years_employed: number | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          email: string
          employer?: string | null
          employer_verification_data?: Json | null
          employer_verified?: boolean | null
          first_name: string
          id?: string
          job_title?: string | null
          last_name: string
          monthly_income?: number | null
          phone: string
          ssn?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          years_employed?: number | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string
          employer?: string | null
          employer_verification_data?: Json | null
          employer_verified?: boolean | null
          first_name?: string
          id?: string
          job_title?: string | null
          last_name?: string
          monthly_income?: number | null
          phone?: string
          ssn?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          years_employed?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      deal_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          deal_id: string
          id: string
          is_internal: boolean
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          deal_id: string
          id?: string
          is_internal?: boolean
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          deal_id?: string
          id?: string
          is_internal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "deal_notes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_timeline: {
        Row: {
          created_at: string
          created_by: string | null
          deal_id: string
          description: string
          id: string
          metadata: Json | null
          type: Database["public"]["Enums"]["timeline_event_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deal_id: string
          description: string
          id?: string
          metadata?: Json | null
          type: Database["public"]["Enums"]["timeline_event_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deal_id?: string
          description?: string
          id?: string
          metadata?: Json | null
          type?: Database["public"]["Enums"]["timeline_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_timeline_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      dealers: {
        Row: {
          city: string | null
          code: string
          contact_name: string
          created_at: string
          email: string
          id: string
          name: string
          phone: string
          state: string | null
          status: Database["public"]["Enums"]["dealer_status"]
          street: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          city?: string | null
          code: string
          contact_name: string
          created_at?: string
          email: string
          id?: string
          name: string
          phone: string
          state?: string | null
          status?: Database["public"]["Enums"]["dealer_status"]
          street?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          city?: string | null
          code?: string
          contact_name?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string
          state?: string | null
          status?: Database["public"]["Enums"]["dealer_status"]
          street?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: []
      }
      deals: {
        Row: {
          apr: number
          assigned_department: Database["public"]["Enums"]["department"] | null
          assigned_to: string | null
          calculated_monthly_income: number | null
          created_at: string
          created_by: string | null
          credit_bureau: Database["public"]["Enums"]["credit_bureau"] | null
          credit_pulled_at: string | null
          credit_score: number | null
          credit_tier: Database["public"]["Enums"]["credit_tier"] | null
          customer_id: string
          deal_number: string
          dealer_id: string
          decision_at: string | null
          decision_by: string | null
          decision_notes: string | null
          down_payment: number
          flags: string[] | null
          funded_amount: number | null
          funded_at: string | null
          id: string
          loan_amount: number
          ltv: number | null
          monthly_payment: number
          priority: Database["public"]["Enums"]["deal_priority"]
          residency_status: string | null
          status: Database["public"]["Enums"]["deal_status"]
          term_months: number
          total_cost: number
          total_interest: number
          trade_in_credit: number | null
          trade_in_make: string | null
          trade_in_mileage: number | null
          trade_in_model: string | null
          trade_in_payoff: number | null
          trade_in_value: number | null
          trade_in_vin: string | null
          trade_in_year: number | null
          updated_at: string
          vehicle_id: string
          work_authorization_expiry: string | null
        }
        Insert: {
          apr: number
          assigned_department?: Database["public"]["Enums"]["department"] | null
          assigned_to?: string | null
          calculated_monthly_income?: number | null
          created_at?: string
          created_by?: string | null
          credit_bureau?: Database["public"]["Enums"]["credit_bureau"] | null
          credit_pulled_at?: string | null
          credit_score?: number | null
          credit_tier?: Database["public"]["Enums"]["credit_tier"] | null
          customer_id: string
          deal_number: string
          dealer_id: string
          decision_at?: string | null
          decision_by?: string | null
          decision_notes?: string | null
          down_payment?: number
          flags?: string[] | null
          funded_amount?: number | null
          funded_at?: string | null
          id?: string
          loan_amount: number
          ltv?: number | null
          monthly_payment: number
          priority?: Database["public"]["Enums"]["deal_priority"]
          residency_status?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          term_months: number
          total_cost: number
          total_interest: number
          trade_in_credit?: number | null
          trade_in_make?: string | null
          trade_in_mileage?: number | null
          trade_in_model?: string | null
          trade_in_payoff?: number | null
          trade_in_value?: number | null
          trade_in_vin?: string | null
          trade_in_year?: number | null
          updated_at?: string
          vehicle_id: string
          work_authorization_expiry?: string | null
        }
        Update: {
          apr?: number
          assigned_department?: Database["public"]["Enums"]["department"] | null
          assigned_to?: string | null
          calculated_monthly_income?: number | null
          created_at?: string
          created_by?: string | null
          credit_bureau?: Database["public"]["Enums"]["credit_bureau"] | null
          credit_pulled_at?: string | null
          credit_score?: number | null
          credit_tier?: Database["public"]["Enums"]["credit_tier"] | null
          customer_id?: string
          deal_number?: string
          dealer_id?: string
          decision_at?: string | null
          decision_by?: string | null
          decision_notes?: string | null
          down_payment?: number
          flags?: string[] | null
          funded_amount?: number | null
          funded_at?: string | null
          id?: string
          loan_amount?: number
          ltv?: number | null
          monthly_payment?: number
          priority?: Database["public"]["Enums"]["deal_priority"]
          residency_status?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          term_months?: number
          total_cost?: number
          total_interest?: number
          trade_in_credit?: number | null
          trade_in_make?: string | null
          trade_in_mileage?: number | null
          trade_in_model?: string | null
          trade_in_payoff?: number | null
          trade_in_value?: number | null
          trade_in_vin?: string | null
          trade_in_year?: number | null
          updated_at?: string
          vehicle_id?: string
          work_authorization_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_dealer_id_fkey"
            columns: ["dealer_id"]
            isOneToOne: false
            referencedRelation: "dealers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          deal_id: string
          file_size: number
          file_url: string
          id: string
          name: string
          notes: string | null
          status: Database["public"]["Enums"]["document_status"]
          type: Database["public"]["Enums"]["document_type"]
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          file_size?: number
          file_url: string
          id?: string
          name: string
          notes?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          type?: Database["public"]["Enums"]["document_type"]
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          file_size?: number
          file_url?: string
          id?: string
          name?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          type?: Database["public"]["Enums"]["document_type"]
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_income_data: {
        Row: {
          confidence: string
          created_at: string
          deal_id: string
          document_id: string
          employer_name_on_doc: string | null
          extracted_at: string
          gross_pay: number | null
          id: string
          income_source_id: string | null
          net_pay: number | null
          pay_date: string | null
          pay_frequency: string | null
          raw_extracted_text: string | null
          ytd_gross: number | null
        }
        Insert: {
          confidence?: string
          created_at?: string
          deal_id: string
          document_id: string
          employer_name_on_doc?: string | null
          extracted_at?: string
          gross_pay?: number | null
          id?: string
          income_source_id?: string | null
          net_pay?: number | null
          pay_date?: string | null
          pay_frequency?: string | null
          raw_extracted_text?: string | null
          ytd_gross?: number | null
        }
        Update: {
          confidence?: string
          created_at?: string
          deal_id?: string
          document_id?: string
          employer_name_on_doc?: string | null
          extracted_at?: string
          gross_pay?: number | null
          id?: string
          income_source_id?: string | null
          net_pay?: number | null
          pay_date?: string | null
          pay_frequency?: string | null
          raw_extracted_text?: string | null
          ytd_gross?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_income_data_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_income_data_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_income_data_income_source_id_fkey"
            columns: ["income_source_id"]
            isOneToOne: false
            referencedRelation: "income_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      income_sources: {
        Row: {
          additional_docs_requested: string[]
          benefit_cap_applied: boolean
          calc_method: string
          calculated_monthly_income: number | null
          contract_months: number | null
          created_at: string
          customer_id: string
          deal_id: string
          employer_name: string
          flag_reasons: string[] | null
          hourly_rate: number | null
          hours_per_week: number | null
          id: string
          is_primary: boolean
          job_title: string | null
          manual_override_amount: number | null
          manual_override_reason: string | null
          missed_days_flag: boolean
          pay_frequency: string | null
          source_type: Database["public"]["Enums"]["income_source_type"]
          stated_monthly_income: number
          tip_percentage: number | null
          updated_at: string
          vehicle_for_work: boolean
          verification_status: Database["public"]["Enums"]["income_verification_status"]
          verified_at: string | null
          verified_by: string | null
          ytd_gross: number | null
          ytd_months: number | null
        }
        Insert: {
          additional_docs_requested?: string[]
          benefit_cap_applied?: boolean
          calc_method?: string
          calculated_monthly_income?: number | null
          contract_months?: number | null
          created_at?: string
          customer_id: string
          deal_id: string
          employer_name: string
          flag_reasons?: string[] | null
          hourly_rate?: number | null
          hours_per_week?: number | null
          id?: string
          is_primary?: boolean
          job_title?: string | null
          manual_override_amount?: number | null
          manual_override_reason?: string | null
          missed_days_flag?: boolean
          pay_frequency?: string | null
          source_type: Database["public"]["Enums"]["income_source_type"]
          stated_monthly_income?: number
          tip_percentage?: number | null
          updated_at?: string
          vehicle_for_work?: boolean
          verification_status?: Database["public"]["Enums"]["income_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          ytd_gross?: number | null
          ytd_months?: number | null
        }
        Update: {
          additional_docs_requested?: string[]
          benefit_cap_applied?: boolean
          calc_method?: string
          calculated_monthly_income?: number | null
          contract_months?: number | null
          created_at?: string
          customer_id?: string
          deal_id?: string
          employer_name?: string
          flag_reasons?: string[] | null
          hourly_rate?: number | null
          hours_per_week?: number | null
          id?: string
          is_primary?: boolean
          job_title?: string | null
          manual_override_amount?: number | null
          manual_override_reason?: string | null
          missed_days_flag?: boolean
          pay_frequency?: string | null
          source_type?: Database["public"]["Enums"]["income_source_type"]
          stated_monthly_income?: number
          tip_percentage?: number | null
          updated_at?: string
          vehicle_for_work?: boolean
          verification_status?: Database["public"]["Enums"]["income_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          ytd_gross?: number | null
          ytd_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "income_sources_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_sources_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          deal_id: string | null
          id: string
          message: string
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          id?: string
          message: string
          read?: boolean
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: Database["public"]["Enums"]["department"] | null
          email: string
          id: string
          is_active: boolean
          last_login: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: Database["public"]["Enums"]["department"] | null
          email: string
          id?: string
          is_active?: boolean
          last_login?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: Database["public"]["Enums"]["department"] | null
          email?: string
          id?: string
          is_active?: boolean
          last_login?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          color: string | null
          condition: Database["public"]["Enums"]["vehicle_condition"]
          created_at: string
          id: string
          invoice_price: number
          make: string
          mileage: number
          model: string
          msrp: number | null
          trim: string | null
          vin: string
          year: number
        }
        Insert: {
          color?: string | null
          condition?: Database["public"]["Enums"]["vehicle_condition"]
          created_at?: string
          id?: string
          invoice_price: number
          make: string
          mileage?: number
          model: string
          msrp?: number | null
          trim?: string | null
          vin: string
          year: number
        }
        Update: {
          color?: string | null
          condition?: Database["public"]["Enums"]["vehicle_condition"]
          created_at?: string
          id?: string
          invoice_price?: number
          make?: string
          mileage?: number
          model?: string
          msrp?: number | null
          trim?: string | null
          vin?: string
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "dealer"
        | "credit_analyst"
        | "income_verifier"
        | "funding_manager"
        | "admin"
      credit_bureau: "experian" | "equifax" | "transunion"
      credit_tier: "prime" | "near_prime" | "subprime" | "deep_subprime"
      deal_priority: "low" | "normal" | "high" | "urgent"
      deal_status:
        | "new_submission"
        | "document_review"
        | "credit_review"
        | "income_verification"
        | "funding_review"
        | "approved"
        | "funded"
        | "declined"
        | "incomplete"
      dealer_status: "active" | "suspended" | "pending"
      debt_type:
        | "garnishment"
        | "child_support"
        | "auto_loan"
        | "student_loan"
        | "credit_card"
        | "mortgage"
        | "medical"
        | "other"
        | "rent"
      department: "credit" | "income" | "funding" | "admin"
      document_status: "pending" | "verified" | "rejected"
      document_type:
        | "credit_application"
        | "income_verification"
        | "pay_stub"
        | "bank_statement"
        | "vehicle_invoice"
        | "trade_in"
        | "insurance"
        | "id_verification"
        | "other"
      income_source_type:
        | "salaried"
        | "part_time"
        | "self_employed"
        | "contractor"
        | "seasonal"
        | "education"
        | "unemployed"
        | "pension"
        | "government_assistance"
      income_verification_status:
        | "unverified"
        | "verified"
        | "flagged"
        | "insufficient_docs"
        | "needs_review"
      notification_type: "info" | "success" | "warning" | "error"
      timeline_event_type:
        | "status_change"
        | "document_upload"
        | "note_added"
        | "assignment"
        | "email_sent"
      vehicle_condition: "new" | "used" | "certified"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "dealer",
        "credit_analyst",
        "income_verifier",
        "funding_manager",
        "admin",
      ],
      credit_bureau: ["experian", "equifax", "transunion"],
      credit_tier: ["prime", "near_prime", "subprime", "deep_subprime"],
      deal_priority: ["low", "normal", "high", "urgent"],
      deal_status: [
        "new_submission",
        "document_review",
        "credit_review",
        "income_verification",
        "funding_review",
        "approved",
        "funded",
        "declined",
        "incomplete",
      ],
      dealer_status: ["active", "suspended", "pending"],
      debt_type: [
        "garnishment",
        "child_support",
        "auto_loan",
        "student_loan",
        "credit_card",
        "mortgage",
        "medical",
        "other",
        "rent",
      ],
      department: ["credit", "income", "funding", "admin"],
      document_status: ["pending", "verified", "rejected"],
      document_type: [
        "credit_application",
        "income_verification",
        "pay_stub",
        "bank_statement",
        "vehicle_invoice",
        "trade_in",
        "insurance",
        "id_verification",
        "other",
      ],
      income_source_type: [
        "salaried",
        "part_time",
        "self_employed",
        "contractor",
        "seasonal",
        "education",
        "unemployed",
        "pension",
        "government_assistance",
      ],
      income_verification_status: [
        "unverified",
        "verified",
        "flagged",
        "insufficient_docs",
        "needs_review",
      ],
      notification_type: ["info", "success", "warning", "error"],
      timeline_event_type: [
        "status_change",
        "document_upload",
        "note_added",
        "assignment",
        "email_sent",
      ],
      vehicle_condition: ["new", "used", "certified"],
    },
  },
} as const
