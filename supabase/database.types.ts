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
    PostgrestVersion: "14.5"
  }
  api: {
    Tables: {
      architecture_projects: {
        Row: {
          artifact_count: number
          artifact_index: Json
          created_at: string
          data: Json
          id: string
          initiative_ids: string[]
          name: string
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          artifact_count?: number
          artifact_index?: Json
          created_at?: string
          data: Json
          id: string
          initiative_ids: string[]
          name: string
          owner_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          artifact_count?: number
          artifact_index?: Json
          created_at?: string
          data?: Json
          id?: string
          initiative_ids?: string[]
          name?: string
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      business_initiatives: {
        Row: {
          code: string
          created_at: string
          data: Json
          horizon: string
          id: string
          need: string
          owner_id: string
          priority: string
          revision: number
          risk_level: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          data: Json
          horizon: string
          id: string
          need: string
          owner_id: string
          priority: string
          revision?: number
          risk_level: string
          status: string
          title: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          data?: Json
          horizon?: string
          id?: string
          need?: string
          owner_id?: string
          priority?: string
          revision?: number
          risk_level?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_probes: {
        Row: {
          created_at: string
          id: string
          label: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          owner_id?: string
        }
        Relationships: []
      }
      project_artifacts: {
        Row: {
          created_at: string
          data: Json
          id: string
          owner_id: string
          project_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          owner_id: string
          project_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
          project_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "architecture_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          id: string
          revision: number
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          revision?: number
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          revision?: number
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_permissions: { Args: never; Returns: string[] }
      delete_business_initiative: {
        Args: { p_expected_revision: number; p_id: string }
        Returns: undefined
      }
      delete_user_profile: { Args: { target: string }; Returns: undefined }
      list_business_initiatives: {
        Args: never
        Returns: {
          code: string
          created_at: string
          data: Json
          horizon: string
          id: string
          need: string
          owner_id: string
          priority: string
          revision: number
          risk_level: string
          status: string
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "business_initiatives"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      load_project_aggregate: { Args: { p_id: string }; Returns: Json }
      provision_user_profile: {
        Args: { target: string; target_name?: string; target_role: string }
        Returns: undefined
      }
      save_business_initiative: {
        Args: { p_expected_revision: number; p_initiative: Json }
        Returns: {
          code: string
          created_at: string
          data: Json
          horizon: string
          id: string
          need: string
          owner_id: string
          priority: string
          revision: number
          risk_level: string
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "business_initiatives"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_project_aggregate: {
        Args: {
          p_artifacts: Json
          p_expected_revision: number
          p_project: Json
        }
        Returns: {
          artifact_count: number
          artifact_index: Json
          created_at: string
          data: Json
          id: string
          initiative_ids: string[]
          name: string
          owner_id: string
          revision: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "architecture_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_user_settings: {
        Args: { p_expected_revision: number; p_settings: Json }
        Returns: {
          created_at: string
          id: string
          revision: number
          settings: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "user_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_user_role: {
        Args: { new_role: string; target: string }
        Returns: undefined
      }
      set_user_status: {
        Args: { new_status: string; target: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  private: {
    Tables: {
      audit_events: {
        Row: {
          actor_id: string
          entity_id: string
          id: string
          occurred_at: string
          operation: string
        }
        Insert: {
          actor_id: string
          entity_id: string
          id?: string
          occurred_at?: string
          operation: string
        }
        Update: {
          actor_id?: string
          entity_id?: string
          id?: string
          occurred_at?: string
          operation?: string
        }
        Relationships: []
      }
      authorization_audit: {
        Row: {
          action: string
          actor_id: string
          from_role: string | null
          id: string
          occurred_at: string
          target_id: string
          to_role: string | null
        }
        Insert: {
          action: string
          actor_id: string
          from_role?: string | null
          id?: string
          occurred_at?: string
          target_id: string
          to_role?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          from_role?: string | null
          id?: string
          occurred_at?: string
          target_id?: string
          to_role?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission: string
          role: string
        }
        Insert: {
          permission: string
          role: string
        }
        Update: {
          permission?: string
          role?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_role_is_not_self: { Args: { target: string }; Returns: undefined }
      assert_session_active: { Args: never; Returns: undefined }
      current_role: { Args: never; Returns: string }
      current_session_id: { Args: never; Returns: string }
      has_permission: { Args: { required: string }; Returns: boolean }
      is_session_active: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
  private: {
    Enums: {},
  },
} as const
