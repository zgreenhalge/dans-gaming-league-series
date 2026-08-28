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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      background_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          gh_run_id: number | null
          gh_run_url: string | null
          id: number
          job_type: string
          map_id: number | null
          match_id: number | null
          requested_by: number | null
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          gh_run_id?: number | null
          gh_run_url?: string | null
          id?: never
          job_type: string
          map_id?: number | null
          match_id?: number | null
          requested_by?: number | null
          stage?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          gh_run_id?: number | null
          gh_run_url?: string | null
          id?: never
          job_type?: string
          map_id?: number | null
          match_id?: number | null
          requested_by?: number | null
          stage?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_jobs_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "background_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      config_set_files: {
        Row: {
          config_set_id: number
          content: string
          id: number
          remote_path: string
        }
        Insert: {
          config_set_id: number
          content: string
          id?: number
          remote_path: string
        }
        Update: {
          config_set_id?: number
          content?: string
          id?: number
          remote_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_set_files_config_set_id_fkey"
            columns: ["config_set_id"]
            isOneToOne: false
            referencedRelation: "config_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      config_sets: {
        Row: {
          created_at: string
          cs2_settings: Json
          id: number
          key: string
          label: string
          server_settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          cs2_settings?: Json
          id?: number
          key: string
          label: string
          server_settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          cs2_settings?: Json
          id?: number
          key?: string
          label?: string
          server_settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      gauntlet_pod_slots: {
        Row: {
          id: number
          player_id: number | null
          pod_id: number
          slot_index: number
          source_kind: string
          source_pod_id: number | null
          source_seed: number | null
        }
        Insert: {
          id?: number
          player_id?: number | null
          pod_id: number
          slot_index: number
          source_kind: string
          source_pod_id?: number | null
          source_seed?: number | null
        }
        Update: {
          id?: number
          player_id?: number | null
          pod_id?: number
          slot_index?: number
          source_kind?: string
          source_pod_id?: number | null
          source_seed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_pod_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "gauntlet_pod_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_pod_slots_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_pods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_pod_slots_source_pod_id_fkey"
            columns: ["source_pod_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_pods"
            referencedColumns: ["id"]
          },
        ]
      }
      gauntlet_pods: {
        Row: {
          advance_rule: string
          id: number
          is_final: boolean
          match1_id: number | null
          match2_id: number | null
          pod_index: number
          round_number: number
          season_id: number
          week_id: number | null
        }
        Insert: {
          advance_rule: string
          id?: number
          is_final?: boolean
          match1_id?: number | null
          match2_id?: number | null
          pod_index: number
          round_number: number
          season_id: number
          week_id?: number | null
        }
        Update: {
          advance_rule?: string
          id?: number
          is_final?: boolean
          match1_id?: number | null
          match2_id?: number | null
          pod_index?: number
          round_number?: number
          season_id?: number
          week_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_pods_match1_id_fkey"
            columns: ["match1_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_pods_match2_id_fkey"
            columns: ["match2_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_pods_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_pods_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      live_match_score: {
        Row: {
          match_id: number
          round: number | null
          shirts_score: number
          skins_score: number
          updated_at: string
        }
        Insert: {
          match_id: number
          round?: number | null
          shirts_score: number
          skins_score: number
          updated_at?: string
        }
        Update: {
          match_id?: number
          round?: number | null
          shirts_score?: number
          skins_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_match_score_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      maps: {
        Row: {
          id: number
          image_url: string | null
          name: string
          radar_image_url: string | null
          radar_pos_x: number | null
          radar_pos_y: number | null
          radar_scale: number | null
          radar_source: string | null
          slug: string
          workshop_url: string | null
        }
        Insert: {
          id?: number
          image_url?: string | null
          name: string
          radar_image_url?: string | null
          radar_pos_x?: number | null
          radar_pos_y?: number | null
          radar_scale?: number | null
          radar_source?: string | null
          slug: string
          workshop_url?: string | null
        }
        Update: {
          id?: number
          image_url?: string | null
          name?: string
          radar_image_url?: string | null
          radar_pos_x?: number | null
          radar_pos_y?: number | null
          radar_scale?: number | null
          radar_source?: string | null
          slug?: string
          workshop_url?: string | null
        }
        Relationships: []
      }
      match_discord_state: {
        Row: {
          event_id: string | null
          match_id: number
          message_checkpoint: string | null
          notification_message_id: string | null
          reminder_sent_at: string | null
          thread_id: string | null
        }
        Insert: {
          event_id?: string | null
          match_id: number
          message_checkpoint?: string | null
          notification_message_id?: string | null
          reminder_sent_at?: string | null
          thread_id?: string | null
        }
        Update: {
          event_id?: string | null
          match_id?: number
          message_checkpoint?: string | null
          notification_message_id?: string | null
          reminder_sent_at?: string | null
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_discord_state_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_kills: {
        Row: {
          assister_player_match_stats_id: number | null
          attacker_player_match_stats_id: number | null
          blind_kill: boolean
          headshot: boolean
          id: number
          is_teamkill: boolean
          match_id: number
          midair: boolean
          noscope: boolean
          round_number: number
          tick: number
          victim_player_match_stats_id: number
          wallbang: boolean
          weapon: string
        }
        Insert: {
          assister_player_match_stats_id?: number | null
          attacker_player_match_stats_id?: number | null
          blind_kill?: boolean
          headshot?: boolean
          id?: never
          is_teamkill?: boolean
          match_id: number
          midair?: boolean
          noscope?: boolean
          round_number: number
          tick: number
          victim_player_match_stats_id: number
          wallbang?: boolean
          weapon: string
        }
        Update: {
          assister_player_match_stats_id?: number | null
          attacker_player_match_stats_id?: number | null
          blind_kill?: boolean
          headshot?: boolean
          id?: never
          is_teamkill?: boolean
          match_id?: number
          midair?: boolean
          noscope?: boolean
          round_number?: number
          tick?: number
          victim_player_match_stats_id?: number
          wallbang?: boolean
          weapon?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_kills_assister_fkey"
            columns: ["assister_player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_kills_attacker_fkey"
            columns: ["attacker_player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_kills_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_kills_victim_fkey"
            columns: ["victim_player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      match_round_economy: {
        Row: {
          economy_type: string
          equipment_value: number
          id: number
          match_id: number
          player_match_stats_id: number
          round_number: number
        }
        Insert: {
          economy_type: string
          equipment_value: number
          id?: never
          match_id: number
          player_match_stats_id: number
          round_number: number
        }
        Update: {
          economy_type?: string
          equipment_value?: number
          id?: never
          match_id?: number
          player_match_stats_id?: number
          round_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_round_economy_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_round_economy_player_fkey"
            columns: ["player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      match_rounds: {
        Row: {
          id: number
          match_id: number
          round_number: number
          shirts_side: string
          win_reason: string | null
          winner_side: string
        }
        Insert: {
          id?: never
          match_id: number
          round_number: number
          shirts_side: string
          win_reason?: string | null
          winner_side: string
        }
        Update: {
          id?: never
          match_id?: number
          round_number?: number
          shirts_side?: string
          win_reason?: string | null
          winner_side?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_rounds_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_server_state: {
        Row: {
          connect_string: string | null
          dathost_server_id: string | null
          match_id: number
          server_started_at: string | null
          server_state: string
          teardown_at: string | null
        }
        Insert: {
          connect_string?: string | null
          dathost_server_id?: string | null
          match_id: number
          server_started_at?: string | null
          server_state?: string
          teardown_at?: string | null
        }
        Update: {
          connect_string?: string | null
          dathost_server_id?: string | null
          match_id?: number
          server_started_at?: string | null
          server_state?: string
          teardown_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_server_state_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_utility_throws: {
        Row: {
          blind_duration: number
          blinded_player_match_stats_id: number
          flasher_player_match_stats_id: number
          id: number
          match_id: number
          round_number: number
          tick: number
        }
        Insert: {
          blind_duration: number
          blinded_player_match_stats_id: number
          flasher_player_match_stats_id: number
          id?: never
          match_id: number
          round_number: number
          tick: number
        }
        Update: {
          blind_duration?: number
          blinded_player_match_stats_id?: number
          flasher_player_match_stats_id?: number
          id?: never
          match_id?: number
          round_number?: number
          tick?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_utility_throws_blinded_fkey"
            columns: ["blinded_player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_utility_throws_flasher_fkey"
            columns: ["flasher_player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_utility_throws_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          final_score: string | null
          id: number
          is_feature_match: boolean
          is_playoff_game: boolean | null
          match_number: number
          picked_map: string | null
          pre_match_win_prob: number | null
          pre_match_win_prob_formula_version: string | null
          recording_url: string | null
          replay_status: string
          round_history: Json | null
          scheduled_at: string | null
          shirts_ban: string | null
          shirts_ban2: string | null
          shirts_pick: string | null
          skins_ban1: string | null
          skins_ban2: string | null
          skins_starting_side: string | null
          week_id: number | null
        }
        Insert: {
          final_score?: string | null
          id?: number
          is_feature_match?: boolean
          is_playoff_game?: boolean | null
          match_number: number
          picked_map?: string | null
          pre_match_win_prob?: number | null
          pre_match_win_prob_formula_version?: string | null
          recording_url?: string | null
          replay_status?: string
          round_history?: Json | null
          scheduled_at?: string | null
          shirts_ban?: string | null
          shirts_ban2?: string | null
          shirts_pick?: string | null
          skins_ban1?: string | null
          skins_ban2?: string | null
          skins_starting_side?: string | null
          week_id?: number | null
        }
        Update: {
          final_score?: string | null
          id?: number
          is_feature_match?: boolean
          is_playoff_game?: boolean | null
          match_number?: number
          picked_map?: string | null
          pre_match_win_prob?: number | null
          pre_match_win_prob_formula_version?: string | null
          recording_url?: string | null
          replay_status?: string
          round_history?: Json | null
          scheduled_at?: string | null
          shirts_ban?: string | null
          shirts_ban2?: string | null
          shirts_pick?: string | null
          skins_ban1?: string | null
          skins_ban2?: string | null
          skins_starting_side?: string | null
          week_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_errors: {
        Row: {
          dismissed_at: string | null
          entity_id: number
          entity_type: string
          id: number
          message: string
          occurred_at: string
          operation: string
        }
        Insert: {
          dismissed_at?: string | null
          entity_id?: number
          entity_type: string
          id?: number
          message: string
          occurred_at?: string
          operation: string
        }
        Update: {
          dismissed_at?: string | null
          entity_id?: number
          entity_type?: string
          id?: number
          message?: string
          occurred_at?: string
          operation?: string
        }
        Relationships: []
      }
      player_current_ratings: {
        Row: {
          ehog_v1: number | null
          player_id: number
          updated_at: string
        }
        Insert: {
          ehog_v1?: number | null
          player_id: number
          updated_at?: string
        }
        Update: {
          ehog_v1?: number | null
          player_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_current_ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_current_ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_match_economy_stats: {
        Row: {
          damage_dealt: number
          economy_type: string
          headshot_hits: number
          id: number
          match_id: number
          player_match_stats_id: number
          rounds_played: number
          shots_fired: number
          shots_hit: number
        }
        Insert: {
          damage_dealt?: number
          economy_type: string
          headshot_hits?: number
          id?: never
          match_id: number
          player_match_stats_id: number
          rounds_played?: number
          shots_fired?: number
          shots_hit?: number
        }
        Update: {
          damage_dealt?: number
          economy_type?: string
          headshot_hits?: number
          id?: never
          match_id?: number
          player_match_stats_id?: number
          rounds_played?: number
          shots_fired?: number
          shots_hit?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_match_economy_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_match_economy_stats_player_match_stats_id_fkey"
            columns: ["player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      player_match_sabremetrics: {
        Row: {
          blind_duration_dealt: number
          blind_duration_max_sum: number
          counter_strafe_good_shots: number
          counter_strafe_shots: number
          ct_smokes_thrown: number
          damage_ct: number
          damage_t: number
          defuses: number
          effective_flashes: number
          enemies_flashed: number
          flash_assists: number
          flashes_leading_to_kill: number
          flashes_thrown: number
          he_damage: number
          he_thrown: number
          headshot_hits_no_awp: number
          kast_rounds: number
          plants: number
          player_match_stats_id: number
          reloads_total: number
          rounds_dropped_on_reload_total: number
          shots_hit_no_awp: number
          smokes_blocking_push: number
          spray_shots_fired: number
          spray_shots_hit: number
          teamflash_duration: number
          trade_kill_attempts: number
          trade_kill_opportunities: number
          trade_kill_successes: number
          traded_death_attempts: number
          traded_death_opportunities: number
          traded_death_successes: number
          unused_util_value_on_death_total: number
          utility_damage: number
        }
        Insert: {
          blind_duration_dealt?: number
          blind_duration_max_sum?: number
          counter_strafe_good_shots?: number
          counter_strafe_shots?: number
          ct_smokes_thrown?: number
          damage_ct?: number
          damage_t?: number
          defuses?: number
          effective_flashes?: number
          enemies_flashed?: number
          flash_assists?: number
          flashes_leading_to_kill?: number
          flashes_thrown?: number
          he_damage?: number
          he_thrown?: number
          headshot_hits_no_awp?: number
          kast_rounds?: number
          plants?: number
          player_match_stats_id: number
          reloads_total?: number
          rounds_dropped_on_reload_total?: number
          shots_hit_no_awp?: number
          smokes_blocking_push?: number
          spray_shots_fired?: number
          spray_shots_hit?: number
          teamflash_duration?: number
          trade_kill_attempts?: number
          trade_kill_opportunities?: number
          trade_kill_successes?: number
          traded_death_attempts?: number
          traded_death_opportunities?: number
          traded_death_successes?: number
          unused_util_value_on_death_total?: number
          utility_damage?: number
        }
        Update: {
          blind_duration_dealt?: number
          blind_duration_max_sum?: number
          counter_strafe_good_shots?: number
          counter_strafe_shots?: number
          ct_smokes_thrown?: number
          damage_ct?: number
          damage_t?: number
          defuses?: number
          effective_flashes?: number
          enemies_flashed?: number
          flash_assists?: number
          flashes_leading_to_kill?: number
          flashes_thrown?: number
          he_damage?: number
          he_thrown?: number
          headshot_hits_no_awp?: number
          kast_rounds?: number
          plants?: number
          player_match_stats_id?: number
          reloads_total?: number
          rounds_dropped_on_reload_total?: number
          shots_hit_no_awp?: number
          smokes_blocking_push?: number
          spray_shots_fired?: number
          spray_shots_hit?: number
          teamflash_duration?: number
          trade_kill_attempts?: number
          trade_kill_opportunities?: number
          trade_kill_successes?: number
          traded_death_attempts?: number
          traded_death_opportunities?: number
          traded_death_successes?: number
          unused_util_value_on_death_total?: number
          utility_damage?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_match_sabremetrics_player_match_stats_id_fkey"
            columns: ["player_match_stats_id"]
            isOneToOne: true
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      player_match_stats: {
        Row: {
          adr: number
          assists: number
          damage: number
          deaths: number
          faction: Database["public"]["Enums"]["faction_side_type"]
          id: number
          is_win: boolean
          kills: number
          match_id: number | null
          player_id: number | null
          rounds_played: number
          rounds_won: number
        }
        Insert: {
          adr?: number
          assists?: number
          damage?: number
          deaths?: number
          faction: Database["public"]["Enums"]["faction_side_type"]
          id?: number
          is_win?: boolean
          kills?: number
          match_id?: number | null
          player_id?: number | null
          rounds_played?: number
          rounds_won?: number
        }
        Update: {
          adr?: number
          assists?: number
          damage?: number
          deaths?: number
          faction?: Database["public"]["Enums"]["faction_side_type"]
          id?: number
          is_win?: boolean
          kills?: number
          match_id?: number | null
          player_id?: number | null
          rounds_played?: number
          rounds_won?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_match_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_match_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_match_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_match_weapon_stats: {
        Row: {
          damage_dealt: number
          headshot_hits: number
          id: number
          match_id: number
          player_match_stats_id: number
          rounds_played: number
          shots_fired: number
          shots_hit: number
          weapon_category: string
        }
        Insert: {
          damage_dealt?: number
          headshot_hits?: number
          id?: never
          match_id: number
          player_match_stats_id: number
          rounds_played?: number
          shots_fired?: number
          shots_hit?: number
          weapon_category: string
        }
        Update: {
          damage_dealt?: number
          headshot_hits?: number
          id?: never
          match_id?: number
          player_match_stats_id?: number
          rounds_played?: number
          shots_fired?: number
          shots_hit?: number
          weapon_category?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_match_weapon_stats_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_match_weapon_stats_player_match_stats_id_fkey"
            columns: ["player_match_stats_id"]
            isOneToOne: false
            referencedRelation: "player_match_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      player_name_history: {
        Row: {
          changed_at: string
          id: number
          new_name: string
          old_name: string
          player_id: number
        }
        Insert: {
          changed_at?: string
          id?: never
          new_name: string
          old_name: string
          player_id: number
        }
        Update: {
          changed_at?: string
          id?: never
          new_name?: string
          old_name?: string
          player_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_name_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_name_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_rating_history: {
        Row: {
          computed_at: string
          ehog_rating: number
          formula_version: string
          id: number
          match_id: number
          mu: number
          player_id: number
          rating_delta: number
          sequence_index: number
          sigma: number
          skill_rating_weight: number
        }
        Insert: {
          computed_at?: string
          ehog_rating: number
          formula_version?: string
          id?: never
          match_id: number
          mu: number
          player_id: number
          rating_delta?: number
          sequence_index: number
          sigma: number
          skill_rating_weight?: number
        }
        Update: {
          computed_at?: string
          ehog_rating?: number
          formula_version?: string
          id?: never
          match_id?: number
          mu?: number
          player_id?: number
          rating_delta?: number
          sequence_index?: number
          sigma?: number
          skill_rating_weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_rating_history_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_rating_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_rating_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          discord_id: string | null
          discord_name_role_id: string | null
          id: number
          is_admin: boolean
          name: string
          name_changed_at: string | null
          seed_ehog: number | null
          steam_avatar_url: string | null
          steam_id: string | null
          steam_nickname: string | null
          steam_refreshed_at: string | null
        }
        Insert: {
          discord_id?: string | null
          discord_name_role_id?: string | null
          id?: number
          is_admin?: boolean
          name: string
          name_changed_at?: string | null
          seed_ehog?: number | null
          steam_avatar_url?: string | null
          steam_id?: string | null
          steam_nickname?: string | null
          steam_refreshed_at?: string | null
        }
        Update: {
          discord_id?: string | null
          discord_name_role_id?: string | null
          id?: number
          is_admin?: boolean
          name?: string
          name_changed_at?: string | null
          seed_ehog?: number | null
          steam_avatar_url?: string | null
          steam_id?: string | null
          steam_nickname?: string | null
          steam_refreshed_at?: string | null
        }
        Relationships: []
      }
      scrim_sessions: {
        Row: {
          id: number
          started_by: number
          warned_10: boolean
          warned_15: boolean
          warned_5: boolean
        }
        Insert: {
          id?: number
          started_by: number
          warned_10?: boolean
          warned_15?: boolean
          warned_5?: boolean
        }
        Update: {
          id?: number
          started_by?: number
          warned_10?: boolean
          warned_15?: boolean
          warned_5?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "scrim_sessions_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "scrim_sessions_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      season_players: {
        Row: {
          id: number
          joined_at: string
          player_id: number
          season_id: number
        }
        Insert: {
          id?: number
          joined_at?: string
          player_id: number
          season_id: number
        }
        Update: {
          id?: number
          joined_at?: string
          player_id?: number
          season_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_players_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      season_schedule_draft_matches: {
        Row: {
          draft_week_id: number
          id: number
          match_number: number
          shirts_player1_id: number
          shirts_player2_id: number
          skins_player1_id: number
          skins_player2_id: number
        }
        Insert: {
          draft_week_id: number
          id?: number
          match_number: number
          shirts_player1_id: number
          shirts_player2_id: number
          skins_player1_id: number
          skins_player2_id: number
        }
        Update: {
          draft_week_id?: number
          id?: number
          match_number?: number
          shirts_player1_id?: number
          shirts_player2_id?: number
          skins_player1_id?: number
          skins_player2_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_schedule_draft_matches_draft_week_id_fkey"
            columns: ["draft_week_id"]
            isOneToOne: false
            referencedRelation: "season_schedule_draft_weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_shirts_player1_id_fkey"
            columns: ["shirts_player1_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_shirts_player1_id_fkey"
            columns: ["shirts_player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_shirts_player2_id_fkey"
            columns: ["shirts_player2_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_shirts_player2_id_fkey"
            columns: ["shirts_player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_skins_player1_id_fkey"
            columns: ["skins_player1_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_skins_player1_id_fkey"
            columns: ["skins_player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_skins_player2_id_fkey"
            columns: ["skins_player2_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_schedule_draft_matches_skins_player2_id_fkey"
            columns: ["skins_player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      season_schedule_draft_weeks: {
        Row: {
          bye_player_id: number | null
          id: number
          season_id: number
          week_number: number
        }
        Insert: {
          bye_player_id?: number | null
          id?: number
          season_id: number
          week_number: number
        }
        Update: {
          bye_player_id?: number | null
          id?: number
          season_id?: number
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_schedule_draft_weeks_bye_player_id_fkey"
            columns: ["bye_player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_schedule_draft_weeks_bye_player_id_fkey"
            columns: ["bye_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_schedule_draft_weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          buy_in_amount: number | null
          id: number
          is_gauntlet: boolean
          map_pool: string[] | null
          name: string
          schedule_draft_locked_at: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["season_status_type"]
          target_win_rounds: number
        }
        Insert: {
          buy_in_amount?: number | null
          id?: number
          is_gauntlet?: boolean
          map_pool?: string[] | null
          name: string
          schedule_draft_locked_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["season_status_type"]
          target_win_rounds?: number
        }
        Update: {
          buy_in_amount?: number | null
          id?: number
          is_gauntlet?: boolean
          map_pool?: string[] | null
          name?: string
          schedule_draft_locked_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["season_status_type"]
          target_win_rounds?: number
        }
        Relationships: []
      }
      weeks: {
        Row: {
          bye_player_id: number | null
          id: number
          season_id: number | null
          week_number: number
        }
        Insert: {
          bye_player_id?: number | null
          id?: number
          season_id?: number | null
          week_number: number
        }
        Update: {
          bye_player_id?: number | null
          id?: number
          season_id?: number | null
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "weeks_bye_player_id_fkey"
            columns: ["bye_player_id"]
            isOneToOne: false
            referencedRelation: "player_season_leaderboard"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "weeks_bye_player_id_fkey"
            columns: ["bye_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      player_season_leaderboard: {
        Row: {
          kd_ratio: number | null
          matches_lost: number | null
          matches_played: number | null
          matches_won: number | null
          overall_adr: number | null
          player_id: number | null
          player_name: string | null
          season_id: number | null
          total_damage: number | null
          total_deaths: number | null
          total_kills: number | null
          total_rounds_played: number | null
          win_rate_percentage: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      clear_season_schedule_draft: {
        Args: { p_season_id: number }
        Returns: undefined
      }
      confirm_season_schedule_draft:
        | { Args: { p_season_id: number }; Returns: Json }
        | { Args: { p_season_id: number; p_weeks: Json }; Returns: Json }
      delete_season_schedule_draft: {
        Args: { p_season_id: number }
        Returns: Json
      }
      generate_season_schedule_draft: {
        Args: { p_season_id: number; p_weeks: Json }
        Returns: Json
      }
      lock_and_check_season_materialized: {
        Args: { p_season_id: number }
        Returns: boolean
      }
      reconcile_gauntlet_draft: {
        Args: {
          p_delete_pod_ids: number[]
          p_new_pods: Json
          p_slot_rewrite_pod_ids: number[]
          p_slots: Json
          p_updated_pods: Json
        }
        Returns: Json
      }
      rollback_season_schedule_draft: {
        Args: { p_season_id: number }
        Returns: Json
      }
      save_season_schedule_draft: {
        Args: { p_season_id: number; p_weeks: Json }
        Returns: Json
      }
      schedule_match_reminder: {
        Args: { p_match_id: number; p_scheduled_at: string }
        Returns: boolean
      }
    }
    Enums: {
      faction_side_type: "SHIRTS" | "SKINS"
      season_status_type: "ARCHIVED" | "ACTIVE" | "UPCOMING"
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
      faction_side_type: ["SHIRTS", "SKINS"],
      season_status_type: ["ARCHIVED", "ACTIVE", "UPCOMING"],
    },
  },
} as const
