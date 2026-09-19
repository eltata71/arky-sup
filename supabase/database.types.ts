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
      agent_actions: {
        Row: {
          created_at: string
          data: Json
          owner_id: string
          project_id: string
          trace_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          owner_id: string
          project_id: string
          trace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          owner_id?: string
          project_id?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "architecture_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_profiles: {
        Row: {
          agent_id: string
          created_at: string
          data: Json
          owner_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          data: Json
          owner_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          data?: Json
          owner_id?: string
          updated_at?: string
        }
      Relationships: []
      }
      architecture_knowledge_graphs: {
        Row: {
          created_at: string
          data: Json
          owner_id: string
          project_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          owner_id: string
          project_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          owner_id?: string
          project_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
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
      artifact_comments: {
        Row: {
          artifact_id: string
          author_id: string
          created_at: string
          data: Json
          id: string
          owner_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          artifact_id: string
          author_id: string
          created_at?: string
          data: Json
          id: string
          owner_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          author_id?: string
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "architecture_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_review_decisions: {
        Row: {
          artifact_id: string
          created_at: string
          data: Json
          id: string
          owner_id: string
          project_id: string
        }
        Insert: {
          artifact_id: string
          created_at?: string
          data: Json
          id: string
          owner_id: string
          project_id: string
        }
        Update: {
          artifact_id?: string
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_review_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "architecture_projects"
            referencedColumns: ["id"]
          },
        ]
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
      file_objects: {
        Row: {
          aggregate_id: string
          bucket_id: string
          context: string
          created_at: string
          created_by: string
          deleted_at: string | null
          entity_id: string
          id: string
          mime_type: string
          object_id: string
          object_path: string
          owner_id: string
          sha256: string
          size_bytes: number
          source_provider: string
          state: string
          updated_at: string
          version: number
        }
        Insert: {
          aggregate_id: string
          bucket_id: string
          context: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          entity_id: string
          id?: string
          mime_type: string
          object_id: string
          object_path: string
          owner_id: string
          sha256: string
          size_bytes: number
          source_provider?: string
          state?: string
          updated_at?: string
          version: number
        }
        Update: {
          aggregate_id?: string
          bucket_id?: string
          context?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          entity_id?: string
          id?: string
          mime_type?: string
          object_id?: string
          object_path?: string
          owner_id?: string
          sha256?: string
          size_bytes?: number
          source_provider?: string
          state?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      lms_context: {
        Row: {
          data: Json
          owner_id: string
          updated_at: string
        }
        Insert: {
          data: Json
          owner_id: string
          updated_at?: string
        }
        Update: {
          data?: Json
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      lms_courses: {
        Row: {
          created_at: string
          data: Json
          id: string
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          owner_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      lms_notes: {
        Row: {
          created_at: string
          data: Json
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      lms_progress: {
        Row: {
          data: Json
          owner_id: string
          updated_at: string
        }
        Insert: {
          data: Json
          owner_id: string
          updated_at?: string
        }
        Update: {
          data?: Json
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      office_arb_decisions: {
        Row: {
          created_at: string
          data: Json
          engagement_id: string
          id: string
          owner_id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          engagement_id: string
          id: string
          owner_id: string
          project_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          engagement_id?: string
          id?: string
          owner_id?: string
          project_id?: string
        }
        Relationships: []
      }
      office_engagements: {
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
      platform_reference_parameters: {
        Row: {
          created_at: string
          data: Json
          key: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data: Json
          key: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          key?: string
          revision?: number
          updated_at?: string
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
      project_chat_history: {
        Row: {
          created_at: string
          messages: Json
          owner_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          messages?: Json
          owner_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          messages?: Json
          owner_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_chat_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
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
      append_agent_action: {
        Args: { p_action: Json; p_project_id: string }
        Returns: undefined
      }
      current_permissions: { Args: never; Returns: string[] }
      delete_agent_profile: { Args: { p_agent_id: string }; Returns: undefined }
      delete_artifact_comment: {
        Args: { p_comment_id: string }
        Returns: undefined
      }
      delete_business_initiative: {
        Args: { p_expected_revision: number; p_id: string }
        Returns: undefined
      }
      delete_course: { Args: { p_course_id: string }; Returns: undefined }
      delete_engagement:
        | {
            Args: { p_engagement_id: string; p_project_id: string }
            Returns: undefined
          }
        | {
            Args: {
              p_engagement_id: string
              p_expected_revision: number
              p_project_id: string
            }
            Returns: undefined
          }
      delete_note: { Args: { p_note_id: string }; Returns: undefined }
      delete_project_aggregate: {
        Args: { p_expected_revision: number; p_id: string }
        Returns: Json
      }
      delete_user_profile: { Args: { target: string }; Returns: undefined }
      list_agent_actions: {
        Args: { p_limit?: number; p_project_id: string }
        Returns: Json
      }
      list_agent_profiles: { Args: never; Returns: Json }
      list_artifact_comments: {
        Args: { p_artifact_id: string; p_project_id: string }
        Returns: Json
      }
      list_artifact_review_decisions: {
        Args: { p_artifact_id: string; p_project_id: string }
        Returns: Json
      }
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
      list_courses: { Args: { p_include_all?: boolean }; Returns: Json }
      list_notes: { Args: never; Returns: Json }
      list_project_aggregates: { Args: never; Returns: Json }
      list_user_profiles: { Args: never; Returns: Json }
      load_chat_history: { Args: { p_project_id: string }; Returns: Json }
      load_context: { Args: never; Returns: Json }
      load_engagements: { Args: { p_project_id: string }; Returns: Json }
      load_knowledge_graph: { Args: { p_project_id: string }; Returns: Json }
      load_own_profile: { Args: never; Returns: Json }
      load_platform_reference_parameters: { Args: never; Returns: Json }
      load_progress: { Args: never; Returns: Json }
      load_project_aggregate: { Args: { p_id: string }; Returns: Json }
      mark_file_object_deleted: {
        Args: { p_file_id: string }
        Returns: undefined
      }
      mark_file_object_ready: {
        Args: { p_file_id: string }
        Returns: {
          aggregate_id: string
          bucket_id: string
          context: string
          created_at: string
          created_by: string
          deleted_at: string | null
          entity_id: string
          id: string
          mime_type: string
          object_id: string
          object_path: string
          owner_id: string
          sha256: string
          size_bytes: number
          source_provider: string
          state: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "file_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provision_user_profile: {
        Args: { target: string; target_name?: string; target_role: string }
        Returns: undefined
      }
      record_arb_decision: { Args: { p_decision: Json }; Returns: undefined }
      record_artifact_review_decision: {
        Args: { p_decision: Json }
        Returns: undefined
      }
      register_file_object: {
        Args: {
          p_aggregate_id: string
          p_bucket_id: string
          p_context: string
          p_entity_id: string
          p_mime_type: string
          p_object_id: string
          p_object_path: string
          p_sha256: string
          p_size_bytes: number
          p_source_provider?: string
          p_version: number
        }
        Returns: {
          aggregate_id: string
          bucket_id: string
          context: string
          created_at: string
          created_by: string
          deleted_at: string | null
          entity_id: string
          id: string
          mime_type: string
          object_id: string
          object_path: string
          owner_id: string
          sha256: string
          size_bytes: number
          source_provider: string
          state: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "file_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_agent_profile: { Args: { p_profile: Json }; Returns: undefined }
      save_artifact_comment: { Args: { p_comment: Json }; Returns: undefined }
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
      save_chat_history: {
        Args: { p_messages: Json; p_project_id: string }
        Returns: undefined
      }
      save_context: { Args: { p_context: Json }; Returns: undefined }
      save_course: {
        Args: { p_course: Json; p_expected_revision: number }
        Returns: {
          created_at: string
          data: Json
          id: string
          owner_id: string
          revision: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lms_courses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_engagement: {
        Args: {
          p_engagement: Json
          p_expected_revision: number
          p_project_id: string
        }
        Returns: {
          created_at: string
          data: Json
          id: string
          owner_id: string
          project_id: string
          revision: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "office_engagements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_knowledge_graph: {
        Args: {
          p_expected_revision: number
          p_graph: Json
          p_project_id: string
        }
        Returns: {
          created_at: string
          data: Json
          owner_id: string
          project_id: string
          revision: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "architecture_knowledge_graphs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_note: { Args: { p_note: Json }; Returns: undefined }
      save_platform_reference_parameters: {
        Args: { p_data: Json; p_expected_revision: number }
        Returns: Json
      }
      save_progress: { Args: { p_progress: Json }; Returns: undefined }
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
      update_own_display_name: {
        Args: { p_display_name: string }
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
} as const
