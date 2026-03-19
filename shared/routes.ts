import { z } from "zod";
import { insertSnippetSchema, snippets } from "./schema";

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const mentorSchemas = {
  input: z.object({
    operation: z.enum(["milling", "drilling", "reaming", "threadmilling", "keyseat", "dovetail"]).default("milling"),
    mode: z.enum(["hem", "traditional", "finish", "face", "slot", "trochoidal", "circ_interp", ""]).default("hem"),
    material: z.string().default("steel"),

    tool_dia: z.number().positive().default(0.5),
    flutes: z.number().int().min(0).default(4),
    tool_type: z.enum(["endmill", "ballnose", "corner_radius", "chamfer_mill"]).default("endmill"),
    corner_radius: z.number().min(0).default(0),
    corner_condition: z.enum(["square", "corner_radius", "ball"]).default("square"),
    geometry: z.enum(["standard", "chipbreaker", "truncated_rougher"]).default("standard"),
    variable_pitch: z.boolean().default(false),
    variable_helix: z.boolean().default(false),
    shank_dia: z.number().min(0).default(0),
    tool_series: z.string().default(""),
    edp: z.string().default(""),
    helix_angle: z.number().min(0).max(90).default(0),
    coating: z.string().default(""),
    target_ra_uin: z.number().min(0).default(0),

    // Chamfer mill specific
    chamfer_series: z.enum(["CMS", "CMH"]).default("CMH"),
    chamfer_angle: z.number().min(0).max(180).default(90),
    chamfer_tip_dia: z.number().min(0).default(0),
    chamfer_depth: z.number().min(0).default(0),

    spindle_taper: z.enum(["CAT30", "CAT40", "CAT50", "BT30", "BT40", "BT50", "HSK63", "HSK100", "VDI30", "VDI40", "VDI50", "BMT45", "BMT55", "BMT65"]).default("CAT40"),
    spindle_drive: z.enum(["direct", "belt", "gear"]).default("belt"),
    machine_type: z.enum(["vmc", "hmc", "5axis", "mill_turn", "lathe"]).default("vmc"),
    toolholder: z.enum(["shrink_fit", "hydraulic", "hp_collet", "er_collet", "milling_chuck", "weldon", "press_fit", "capto"]).default("er_collet"),
    holder_gage_length: z.number().min(0).default(0),
    holder_nose_dia: z.number().min(0).default(0),
    dual_contact: z.boolean().default(false),
    workholding: z.enum(["rigid_fixture", "tombstone", "dovetail", "vise", "soft_jaws", "3_jaw_chuck", "4_jaw_chuck", "collet_chuck", "between_centers", "face_plate"]).default("vise"),
    coolant: z.enum(["dry", "mist", "flood", "tsc_low", "tsc_high"]).default("flood"),

    max_rpm: z.number().int().min(0).default(12000),
    rpm_util_pct: z.number().positive().max(1).default(0.95),
    drill_feed_util_pct: z.number().positive().max(1).default(0.90),

    woc_pct: z.number().min(0).default(0.1),
    doc_xd: z.number().min(0).default(1.0),

    loc: z.number().min(0).default(0.75),
    lbs: z.number().min(0).default(0),

    machine_hp: z.number().min(0).default(10),
    stickout: z.number().min(0).default(2.0),

    existing_hole_dia: z.number().min(0).default(0),
    target_hole_dia: z.number().min(0).default(0),

    hardness_value: z.number().min(0).default(0),
    hardness_scale: z.enum(["hrb", "hrc"]).default("hrc"),

    // Drilling-specific
    drill_point_angle: z.number().int().default(135),
    drill_flute_length: z.number().min(0).default(0),
    drill_hole_depth: z.number().min(0).default(0),
    drill_blind: z.boolean().default(false),
    drill_geometry: z.enum(["standard", "med_helix", "high_helix"]).default("standard"),
    drill_coolant_fed: z.boolean().default(false),
    drill_steps: z.number().int().min(0).max(3).default(0),
    drill_step_diameters: z.array(z.number().positive()).max(3).default([]),
    drill_step_lengths: z.array(z.number().positive()).max(3).default([]),

    // Reaming-specific
    ream_pre_drill_dia: z.number().min(0).default(0),
    ream_hole_depth: z.number().min(0).default(0),
    ream_blind: z.boolean().default(false),
    ream_coolant_fed: z.boolean().default(false),
    ream_steps: z.number().int().min(0).max(3).default(0),
    ream_step_diameters: z.array(z.number().positive()).max(3).default([]),
    ream_step_lengths: z.array(z.number().positive()).max(3).default([]),
    ream_lead_chamfer: z.enum(["standard", "long_lead", "short_lead"]).default("standard"),

    // Thread milling-specific
    thread_standard: z.enum(["unc", "unf", "unef", "metric", "npt", "nptf"]).default("unc"),
    thread_major_dia: z.number().default(0.5),
    thread_tpi: z.number().optional(),
    thread_pitch_mm: z.number().optional(),
    thread_class: z.enum(["1A", "1B", "2A", "2B", "3A", "3B", "6H", "6g"]).default("2B"),
    thread_internal: z.boolean().default(true),
    thread_engagement: z.number().default(0.5),
    thread_hand: z.enum(["right", "left"]).default("right"),
    thread_rows: z.number().int().min(1).max(4).default(1),
    thread_neck_length: z.number().default(0),
    npt_size: z.string().default(""),
    thread_gcode_dialect: z.enum(["fanuc", "siemens"]).default("fanuc"),
    thread_cut_direction: z.enum(["top_down", "bottom_up"]).default("top_down"),

    // Keyseat-specific
    keyseat_arbor_dia: z.number().min(0).default(0),
    final_slot_depth: z.number().min(0).default(0),

    // Dovetail-specific
    dovetail_angle: z.number().min(0).max(180).default(60),

    quiet: z.boolean().default(true),
    debug: z.boolean().default(false),
  }),

  response: z.object({
    customer: z.object({
      material: z.string(),
      diameter: z.number(),
      flutes: z.number(),

      rpm: z.number(),
      sfm: z.number().optional().nullable(),
      sfm_target: z.number().optional().nullable(),

      feed_ipm: z.number(),
      doc_in: z.number(),
      woc_in: z.number(),

      mrr_in3_min: z.number(),
      spindle_load_pct: z.number(),
      hp_required: z.number().optional(),

      machine_hp: z.number().nullable().optional(),
      hp_util_pct: z.number().nullable().optional(),
      hp_margin_hp: z.number().nullable().optional(),
      
      fpt: z.number().optional(),
      adj_fpt: z.number().nullable().optional(),

      peripheral_feed_ipm: z.number().nullable().optional(),
      ci_a_e_in: z.number().nullable().optional(),
      ci_feed_ratio: z.number().nullable().optional(),

      recommended_stepover: z.number().nullable().optional(),
      ra_actual_uin: z.number().nullable().optional(),
      ra_feed_capped: z.boolean().optional(),

      status: z.string().nullable().optional(),
      status_hint: z.string().nullable().optional(),
      risk: z.string().nullable().optional(),
      notes: z.array(z.string()).nullable().optional(),
    }),

    engineering: z.object({
      force_lbf: z.number().nullable().optional(),
      torque_inlbf: z.number().nullable().optional(),
      torque_capacity_inlbf: z.number().nullable().optional(),
      torque_pct: z.number().nullable().optional(),
      deflection_in: z.number().optional(),
      chip_thickness_in: z.number().optional(),
      chatter_index: z.number().optional(),
      teeth_in_cut: z.number().optional(),
      helix_wrap_deg: z.number().nullable().optional(),
      engagement_continuous: z.boolean().nullable().optional(),
      tool_life_min: z.number().nullable().optional(),
    }),

    stability: z.object({
      stickout_in: z.number(),
      l_over_d: z.number(),
      deflection_in: z.number(),
      deflection_limit_in: z.number(),
      deflection_pct: z.number(),
      suggestions: z.array(z.object({
        type: z.string(),
        label: z.string(),
        detail: z.string(),
        stickout_in: z.number().optional(),
        gain_pct: z.number().optional(),
        suggested_flutes: z.number().optional(),
        suggested_edp: z.string().optional(),
        suggested_edps: z.array(z.string()).optional(),
      })),
    }).nullable().optional(),

    reaming: z.object({
      rpm: z.number(),
      sfm: z.number(),
      ipm: z.number(),
      ipr: z.number(),
      hp_required: z.number(),
      depth_xd: z.number(),
      depth_status: z.enum(["ok", "caution", "warning"]),
      depth_note: z.string().nullable(),
      stock_per_side_in: z.number().nullable(),
      stock_total_in: z.number().nullable(),
      stock_ideal_in: z.number(),
      stock_min_in: z.number(),
      stock_max_in: z.number(),
      stock_status: z.string(),
      stock_warning: z.string().nullable(),
      confidence: z.enum(["green", "yellow", "orange", "red"]),
      risk_flags: z.array(z.string()),
      coolant_identity: z.string(),
      entry_dia: z.number().optional(),
      largest_dia: z.number().optional(),
      helix_rec: z.string().optional(),
      helix_note: z.string().optional(),
      helix_angle_note: z.string().optional(),
      helix_warnings: z.array(z.string()).optional(),
      coating_rec: z.string().optional(),
      iso_category: z.string().optional(),
      finish_ra_base_min: z.number().optional(),
      finish_ra_base_max: z.number().optional(),
      finish_risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
      finish_notes: z.array(z.string()).optional(),
      straightness_risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
      straightness_notes: z.array(z.string()).optional(),
      tool_life_lo: z.number().optional(),
      tool_life_hi: z.number().optional(),
    }).nullable().optional(),

    drilling: z.object({
      rpm: z.number(),
      sfm: z.number(),
      ipm: z.number(),
      ipr: z.number(),
      mrr_in3_min: z.number(),
      thrust_lbf: z.number(),
      torque_inlbf: z.number(),
      hp_required: z.number(),
      depth_to_dia: z.number(),
      cycle: z.string(),
      cycle_note: z.string(),
      peck_depth_in: z.number().nullable(),
      r_plane_in: z.number(),
      peck_schedule: z.array(z.number()).nullable().optional(),
      flute_warning: z.string().nullable(),
      chip_warning: z.string().nullable().optional(),
      geometry_tip: z.string().nullable().optional(),
      drill_stability: z.object({
        feed_status:  z.enum(["ok", "caution", "warning"]),
        feed_ratio:   z.number(),
        evac_status:  z.enum(["ok", "caution", "warning"]),
        depth_status: z.enum(["ok", "caution", "warning"]),
        depth_xd:     z.number(),
      }).optional(),
      entry_dia: z.number().optional(),
      largest_dia: z.number().optional(),
    }).optional().nullable(),

    chamfer: z.object({
      d_eff_in: z.number(),
      chamfer_angle_deg: z.number(),
      tip_dia_in: z.number(),
      chamfer_depth_in: z.number(),
    }).nullable().optional(),

    keyseat: z.object({
      arbor_dia_in: z.number().nullable().optional(),
      doc_in: z.number(),
      max_safe_doc_in: z.number().optional(),
      flute_reach_in: z.number().optional(),
      engagement: z.string(),
      multi_pass: z.object({
        num_passes: z.number(),
        depth_per_pass_in: z.number(),
        final_slot_depth_in: z.number(),
        max_safe_doc_in: z.number(),
        aggressive: z.boolean(),
      }).nullable().optional(),
      tips: z.array(z.string()),
    }).nullable().optional(),

    dovetail: z.object({
      dovetail_angle_deg: z.number(),
      doc_in: z.number(),
      max_safe_doc_in: z.number().optional(),
      flute_reach_in: z.number().optional(),
      lead_ctf: z.number(),
      multi_pass: z.object({
        num_passes: z.number(),
        depth_per_pass_in: z.number(),
        final_slot_depth_in: z.number(),
        max_safe_doc_in: z.number(),
        aggressive: z.boolean(),
      }).nullable().optional(),
      tips: z.array(z.string()),
    }).nullable().optional(),

    thread_mill: z.object({
      rpm: z.number(),
      sfm: z.number(),
      feed_ipm: z.number(),
      fpt: z.number(),
      pitch_in: z.number(),
      tpi: z.number(),
      thread_depth_in: z.number(),
      minor_dia_in: z.number(),
      pitch_dia_in: z.number(),
      radial_passes: z.number(),
      spring_pass: z.boolean(),
      doc_per_pass_in: z.number(),
      pass_docs: z.array(z.number()).optional(),
      finish_pass_frac: z.number().optional(),
      cut_direction: z.string().optional(),
      deflection_in: z.number(),
      deflection_pct: z.number(),
      gcode: z.string(),
      notes: z.array(z.string()),
      tool_rows: z.number(),
      is_tapered: z.boolean(),
      hand: z.string(),
      internal: z.boolean(),
    }).optional(),

    entry_moves: z.object({
      ramp_angle_deg:        z.number(),
      standard_ramp_ipm:     z.number(),
      standard_helix_ipm:    z.number(),
      advanced_ramp_ipm:     z.number(),
      advanced_helix_ipm:    z.number(),
      helix_bore_min_in:     z.number(),
      helix_bore_ideal_low:  z.number(),
      helix_bore_ideal_high: z.number(),
      helix_pitch_in:        z.number(),
      helix_angle_deg:       z.number(),
      adv_helix_pitch_in:    z.number().optional(),
      adv_helix_angle_deg:   z.number().optional(),
    }).nullable().optional(),

    debug: z.unknown().nullable().optional(),
  }),
};

export const api = {
  snippets: {
    list: {
      method: "GET" as const,
      path: "/api/snippets" as const,
      responses: {
        200: z.array(z.custom<typeof snippets.$inferSelect>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/snippets/:id" as const,
      responses: {
        200: z.custom<typeof snippets.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/snippets" as const,
      input: insertSnippetSchema,
      responses: {
        201: z.custom<typeof snippets.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/snippets/:id" as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },

  mentor: {
    run: {
      method: "POST" as const,
      path: "/api/mentor" as const,
      input: mentorSchemas.input,
      responses: {
        200: mentorSchemas.response,
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type SnippetInput = z.infer<typeof api.snippets.create.input>;
export type SnippetResponse = z.infer<typeof api.snippets.create.responses[201]>;

export type MentorInput = z.infer<typeof mentorSchemas.input>;
export type MentorResponse = z.infer<typeof mentorSchemas.response>;