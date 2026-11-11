// OrcaSlicer option defaults (PrintConfig.cpp) used when a preset chain does not define an option.
export const ORCA_DEFAULTS = {
 "accel_to_decel_enable": "1",
 "accel_to_decel_factor": "50%",
 "activate_air_filtration_during_print": [
  "1"
 ],
 "activate_air_filtration_on_completion": [
  "1"
 ],
 "activate_chamber_temp_control": [
  "0"
 ],
 "adaptive_bed_mesh_margin": "0",
 "adaptive_infill_gradient": "linear",
 "adaptive_infill_interior_density": "5%",
 "adaptive_infill_mode": "disabled",
 "adaptive_pressure_advance": [
  "0"
 ],
 "adaptive_pressure_advance_bridges": [
  "0"
 ],
 "adaptive_pressure_advance_model": [
  "0,0,0\n0,0,0"
 ],
 "adaptive_pressure_advance_overhangs": [
  "0"
 ],
 "additional_fan_full_speed_layer": [
  "0"
 ],
 "align_infill_direction_to_model": "0",
 "alternate_extra_wall": "0",
 "bbl_calib_mark_logo": "1",
 "bbl_use_printhost": "0",
 "bed_custom_model": "",
 "bed_custom_texture": "",
 "bed_exclude_volume_mode": "shared",
 "bed_exclude_volumes": "",
 "bed_mesh_probe_distance": "50,50",
 "bed_temperature_formula": "by_highest_temp",
 "belt_frame_tilt_angle": "45",
 "belt_frame_tilt_decouple": "0",
 "belt_printer": "0",
 "belt_printer_infinite_y": "1",
 "belt_purge_tower_object": "0",
 "belt_purge_tower_width": "35",
 "belt_slice_rotation": "x",
 "belt_slice_rotation_angle": "45",
 "belt_support_floor_offset": "0",
 "best_object_pos": "0.5,0.5",
 "bottom_layer_direction": "-1",
 "bottom_solid_infill_flow_ratio": "1",
 "bottom_surface_density": "100%",
 "bottom_surface_filament_id": "0",
 "bottom_surface_fill_order": "default",
 "bridge_acceleration": [
  "50%"
 ],
 "bridge_angle": "0",
 "bridge_density": "100%",
 "bridge_line_width": "100%",
 "brim_ears_detection_length": "1",
 "brim_ears_max_angle": "125",
 "brim_ears_outer_only": "0",
 "brim_flow_ratio": "1",
 "brim_type": "auto_brim",
 "brim_use_efc_outline": "0",
 "build_plate_tilt_x": "0",
 "build_plate_tilt_y": "0",
 "calib_flowrate_topinfill_special_order": "0",
 "center_of_surface_pattern": "each_surface",
 "chamber_minimal_temperature": [
  "0"
 ],
 "chamber_temperature": [
  "0"
 ],
 "change_extrusion_role_gcode": "",
 "close_additional_fan_first_x_layers": [
  "1"
 ],
 "combine_brims": "0",
 "cooling_filter_enabled": "0",
 "cooling_tube_length": "5",
 "cooling_tube_retraction": "91.5",
 "counterbore_hole_bridging": "none",
 "curr_bed_type": "High Temp Plate",
 "default_filament_colour": [
  ""
 ],
 "default_jerk": [
  "0"
 ],
 "default_junction_deviation": [
  "0"
 ],
 "deretract_speed_extruder_change": [
  "0"
 ],
 "detect_narrow_internal_solid_infill": "1",
 "disable_m73": "0",
 "dont_filter_internal_bridges": "disabled",
 "dont_slow_down_outer_wall": [
  "0"
 ],
 "elefant_foot_compensation_layers": "1",
 "elefant_foot_layers_density": "100%",
 "emit_machine_limits_to_gcode": "1",
 "enable_belt_purge_tower": "0",
 "enable_extra_bridge_layer": "disabled",
 "enable_filament_dynamic_map": "0",
 "enable_long_retraction_when_cut": "0",
 "enable_mixed_color_sublayer": "0",
 "enable_overhang_bridge_fan": [
  "1"
 ],
 "enable_overhang_speed": [
  "1"
 ],
 "enable_power_loss_recovery": "printer_configuration",
 "enable_pre_heating": "0",
 "enable_pressure_advance": [
  "0"
 ],
 "enable_tower_interface_cooldown_during_tower": "0",
 "enable_tower_interface_features": "0",
 "enable_wrapping_detection": "0",
 "enforce_support_layers": "0",
 "ensure_vertical_shell_thickness": "ensure_all",
 "exclude_object_tolerance": "0.1",
 "extra_brim_width": "0",
 "extra_loading_move": "-2",
 "extra_perimeters_on_overhangs": "0",
 "extra_solid_infills": "",
 "extruder_ams_count": [
  "1#0|4#0"
 ],
 "extruder_bed_exclude_volumes": [
  ""
 ],
 "extruder_clearance_dist_to_rod": "40",
 "extruder_max_nozzle_count": [
  "1"
 ],
 "extruder_nozzle_stats": [
  "Standard#1"
 ],
 "extruder_printable_area": [],
 "extruder_printable_height": [
  "0"
 ],
 "extruder_type": [
  "Direct Drive"
 ],
 "extrusion_rate_smoothing_external_perimeter_only": "0",
 "fan_direction": "undefine",
 "fan_kickstart": "0",
 "fan_speedup_overhangs": "1",
 "fan_speedup_time": "0",
 "farthest_point_timelapse": "0",
 "filament_adaptive_volumetric_speed": [
  "0"
 ],
 "filament_adhesiveness_category": [
  "0"
 ],
 "filament_change_extrusion_role_gcode": [
  ""
 ],
 "filament_change_length": [
  "10"
 ],
 "filament_change_length_nc": [
  "10"
 ],
 "filament_colour_type": [
  "1"
 ],
 "filament_cooling_before_tower": [
  "10"
 ],
 "filament_cooling_final_speed": [
  "3.4"
 ],
 "filament_cooling_initial_speed": [
  "2.2"
 ],
 "filament_cooling_moves": [
  "4"
 ],
 "filament_dev_ams_drying_ams_limitations": [
  ""
 ],
 "filament_dev_ams_drying_heat_distortion_temperature": [
  "0"
 ],
 "filament_dev_ams_drying_temperature": [
  "0"
 ],
 "filament_dev_ams_drying_time": [
  "0"
 ],
 "filament_dev_chamber_drying_bed_temperature": [
  "0"
 ],
 "filament_dev_chamber_drying_time": [
  "0"
 ],
 "filament_dev_drying_cooling_temperature": [
  "0"
 ],
 "filament_dev_drying_softening_temperature": [
  "0"
 ],
 "filament_extruder_compatibility": [
  "0"
 ],
 "filament_flush_temp": [
  "0"
 ],
 "filament_flush_temp_fast": [
  "0"
 ],
 "filament_flush_volumetric_speed": [
  "0"
 ],
 "filament_ironing_flow": [
  "nil"
 ],
 "filament_ironing_inset": [
  "nil"
 ],
 "filament_ironing_spacing": [
  "nil"
 ],
 "filament_ironing_speed": [
  "nil"
 ],
 "filament_is_mixed": [
  "0"
 ],
 "filament_loading_speed": [
  "28"
 ],
 "filament_loading_speed_start": [
  "3"
 ],
 "filament_map_mode": "Auto For Flush",
 "filament_mixed_components": [
  ""
 ],
 "filament_mixed_gradient": [
  "0"
 ],
 "filament_mixed_gradient_curve": [
  ""
 ],
 "filament_mixed_gradient_per_part": [
  "0"
 ],
 "filament_mixed_gradient_range": [
  ""
 ],
 "filament_mixed_sublayer_ratios": [
  ""
 ],
 "filament_notes": [
  ""
 ],
 "filament_plugin_config_overrides": "",
 "filament_pre_cooling_temperature": [
  "0"
 ],
 "filament_pre_cooling_temperature_nc": [
  "0"
 ],
 "filament_preheat_temperature_delta": [
  "0"
 ],
 "filament_prime_volume": [
  "45"
 ],
 "filament_prime_volume_nc": [
  "60"
 ],
 "filament_printable": [
  "3"
 ],
 "filament_ramming_parameters": [
  "120 100 6.6 6.8 7.2 7.6 7.9 8.2 8.7 9.4 9.9 10.0| 0.05 6.6 0.45 6.8 0.95 7.8 1.45 8.3 1.95 9.7 2.45 10 2.95 7.6 3.45 7.6 3.95 7.6 4.45 7.6 4.95 7.6"
 ],
 "filament_ramming_travel_time": [
  "0"
 ],
 "filament_ramming_travel_time_nc": [
  "0"
 ],
 "filament_ramming_volumetric_speed": [
  "-1"
 ],
 "filament_ramming_volumetric_speed_nc": [
  "-1"
 ],
 "filament_retract_after_wipe": [
  "nil"
 ],
 "filament_retract_length_nc": [
  "nil"
 ],
 "filament_retract_length_toolchange": [
  "nil"
 ],
 "filament_retract_lift_above": [
  "nil"
 ],
 "filament_retract_lift_below": [
  "nil"
 ],
 "filament_retract_lift_enforce": [
  "nil"
 ],
 "filament_retract_restart_extra_toolchange": [
  "nil"
 ],
 "filament_shrinkage_compensation_z": [
  "100%"
 ],
 "filament_stamping_distance": [
  "0"
 ],
 "filament_stamping_loading_speed": [
  "0"
 ],
 "filament_toolchange_delay": [
  "0"
 ],
 "filament_tower_interface_pre_extrusion_dist": [
  "10"
 ],
 "filament_tower_interface_pre_extrusion_length": [
  "0"
 ],
 "filament_tower_interface_print_temp": [
  "-1"
 ],
 "filament_tower_interface_purge_volume": [
  "20"
 ],
 "filament_tower_ironing_area": [
  "4"
 ],
 "filament_unloading_speed": [
  "90"
 ],
 "filament_unloading_speed_start": [
  "100"
 ],
 "file_start_gcode": "",
 "fill_multiline": "1",
 "filter_out_gap_fill": "0",
 "first_layer_flow_ratio": "1",
 "first_layer_print_sequence": [
  "0"
 ],
 "first_x_layer_fan_speed": [
  "0"
 ],
 "flashforge_serial_number": "",
 "flush_into_infill": "0",
 "flush_into_objects": "0",
 "flush_into_support": "1",
 "flush_multiplier": [
  "0",
  "1",
  "1",
  "1"
 ],
 "flush_multiplier_fast": [
  "1.2"
 ],
 "flush_volumes_matrix": [
  "0",
  "373",
  "326",
  "203",
  "615",
  "280",
  "547",
  "462",
  "468",
  "363",
  "0",
  "272",
  "387",
  "336",
  "376",
  "0",
  "280",
  "373",
  "326",
  "203",
  "615",
  "280",
  "547",
  "462",
  "468",
  "363",
  "0",
  "272",
  "387",
  "336",
  "376",
  "0",
  "280",
  "373",
  "326",
  "203",
  "615",
  "280",
  "547",
  "462",
  "468",
  "363",
  "0",
  "272",
  "387",
  "336",
  "376",
  "0",
  "280",
  "373",
  "326",
  "203",
  "615",
  "0",
  "547",
  "462",
  "468",
  "363",
  "0",
  "272",
  "387",
  "336",
  "376",
  "0"
 ],
 "flush_volumes_vector": [
  "140"
 ],
 "fuzzy_skin": "disabled_fuzzy",
 "fuzzy_skin_first_layer": "0",
 "fuzzy_skin_layers_between_ripple_offset": "1",
 "fuzzy_skin_mode": "displacement",
 "fuzzy_skin_noise_type": "classic",
 "fuzzy_skin_octaves": "4",
 "fuzzy_skin_persistence": "0.5",
 "fuzzy_skin_point_distance": "0.3",
 "fuzzy_skin_ripple_offset": "50%",
 "fuzzy_skin_ripples_per_layer": "15",
 "fuzzy_skin_scale": "1",
 "fuzzy_skin_thickness": "0.2",
 "gap_fill_flow_ratio": "1",
 "gap_fill_target": "nowhere",
 "gcode_add_line_number": "0",
 "gcode_comments": "0",
 "gcode_label_objects": "1",
 "gcode_remap_x": "pos_x",
 "gcode_remap_y": "pos_y",
 "gcode_remap_z": "pos_z",
 "gcode_skip_config_block": "0",
 "grab_length": [
  "0"
 ],
 "group_algo_with_time": "0",
 "gyroid_optimized": "0",
 "has_filament_switcher": "0",
 "has_scarf_joint_seam": "0",
 "head_wrap_detect_zone": [],
 "high_current_on_filament_swap": "0",
 "high_precision_gcode": "0",
 "hole_to_polyhole": "0",
 "hole_to_polyhole_max_edges": "50",
 "hole_to_polyhole_threshold": "0.01",
 "hole_to_polyhole_twisted": "1",
 "hotend_cooling_rate": [
  "2"
 ],
 "hotend_heating_rate": [
  "2"
 ],
 "idle_temperature": [
  "0"
 ],
 "imex_carriage_margin": "0",
 "imex_firmware_managed_zones": "0",
 "imex_gantry_count": "1",
 "imex_head_filament_map": "",
 "imex_mode_active_tools": [],
 "imex_mode_gcodes": [],
 "imex_mode_names": [],
 "imex_nozzle_clearance_x": "30",
 "imex_nozzle_clearance_y": "30",
 "imex_parallel_mode": "primary",
 "imex_tool_layout": "front-left",
 "imex_tools_per_gantry": "2",
 "imex_viz_theme": "standard",
 "independent_support_layer_height": "1",
 "infill_anchor": "400%",
 "infill_anchor_max": "20",
 "infill_combination_max_layer_height": "100%",
 "infill_complete_top": "0",
 "infill_jerk": [
  "9"
 ],
 "infill_lock_depth": "1",
 "infill_overhang_angle": "60",
 "infill_shift_step": "0.4",
 "initial_layer_fan_speed": [
  "-1"
 ],
 "initial_layer_jerk": [
  "9"
 ],
 "initial_layer_min_bead_width": "85%",
 "initial_layer_travel_acceleration": [
  "100%"
 ],
 "initial_layer_travel_jerk": [
  "100%"
 ],
 "initial_layer_travel_speed": [
  "100%"
 ],
 "inner_wall_acceleration": [
  "10000"
 ],
 "inner_wall_filament_id": "0",
 "inner_wall_flow_ratio": "1",
 "inner_wall_jerk": [
  "9"
 ],
 "input_shaping_damp_x": "0.1",
 "input_shaping_damp_y": "0.1",
 "input_shaping_emit": "0",
 "input_shaping_freq_x": "0",
 "input_shaping_freq_y": "0",
 "input_shaping_type": "Default",
 "interlocking_beam": "0",
 "interlocking_beam_layer_count": "2",
 "interlocking_beam_width": "0.8",
 "interlocking_boundary_avoidance": "2",
 "interlocking_depth": "2",
 "interlocking_orientation": "22.5",
 "internal_bridge_angle": "0",
 "internal_bridge_density": "100%",
 "internal_bridge_fan_speed": [
  "-1"
 ],
 "internal_bridge_flow": "1",
 "internal_bridge_speed": [
  "150%"
 ],
 "internal_solid_filament_id": "0",
 "internal_solid_infill_acceleration": [
  "100%"
 ],
 "internal_solid_infill_flow_ratio": "1",
 "internal_solid_infill_pattern": "monotonic",
 "ironing_angle": "0",
 "ironing_angle_fixed": "0",
 "ironing_expansion": "0",
 "ironing_fan_speed": [
  "-1"
 ],
 "ironing_inset": "0",
 "ironing_pattern": "rectilinear",
 "is_imex": "0",
 "is_infill_first": "0",
 "lateral_lattice_angle_1": "-45",
 "lateral_lattice_angle_2": "45",
 "leading_brim_length": "0",
 "lightning_overhang_angle": "45",
 "lightning_prune_angle": "45",
 "lightning_straightening_angle": "45",
 "long_retractions_when_ec": [
  "0"
 ],
 "machine_bed_mass_Y": "0",
 "machine_hotend_change_time": "0",
 "machine_max_force_Y": "0",
 "machine_max_junction_deviation": [
  "0.01"
 ],
 "machine_max_printed_mass": "0",
 "machine_prepare_compensation_time": "260",
 "make_overhang_printable": "0",
 "make_overhang_printable_angle": "55",
 "make_overhang_printable_hole_size": "0",
 "manual_filament_change": "0",
 "master_extruder_id": "1",
 "max_bridge_length": "10",
 "max_volumetric_extrusion_rate_slope": "0",
 "max_volumetric_extrusion_rate_slope_segment_length": "3",
 "min_bead_width": "85%",
 "min_feature_size": "25%",
 "min_length_factor": "0.5",
 "min_skirt_length": "0",
 "min_width_top_surface": "300%",
 "mmu_segmented_region_interlocking_depth": "0",
 "mmu_segmented_region_max_width": "0",
 "notes": "",
 "nozzle_flush_dataset": [
  "0"
 ],
 "nozzle_height": "2.5",
 "nozzle_hrc": "0",
 "nozzle_volume_type": [
  "Standard"
 ],
 "only_one_wall_first_layer": "0",
 "other_layers_print_sequence": [
  "0"
 ],
 "other_layers_print_sequence_nums": "0",
 "outer_wall_filament_id": "0",
 "outer_wall_flow_ratio": "1",
 "outer_wall_jerk": [
  "9"
 ],
 "overhang_flow_ratio": "1",
 "overhang_reverse": "0",
 "overhang_reverse_internal_only": "0",
 "overhang_reverse_threshold": "50%",
 "parallel_printheads_bed_exclude_areas": [],
 "parallel_printheads_count": "1",
 "parking_pos_retraction": "92",
 "part_cooling_fan_min_pwm": "0",
 "pellet_flow_coefficient": [
  "0.4157"
 ],
 "pellet_modded_printer": "0",
 "physical_extruder_map": [
  "0"
 ],
 "post_process": [],
 "precise_outer_wall": "1",
 "precise_z_height": "0",
 "preferred_orientation": "0",
 "preheat_steps": "1",
 "pressure_advance": [
  "0.02"
 ],
 "prime_tower_enable_framework": "0",
 "prime_tower_flat_ironing": "0",
 "prime_tower_infill_gap": "150%",
 "prime_tower_skip_points": "1",
 "prime_volume_mode": "Default",
 "print_flow_ratio": "1",
 "print_order": "default",
 "print_plugin_config_overrides": "",
 "printer_notes": "",
 "printer_plugin_config_overrides": "",
 "printhost_authorization_type": "key",
 "printhost_ssl_ignore_revoke": "0",
 "printing_by_object_gcode": "",
 "process_change_extrusion_role_gcode": "",
 "raft_contact_distance": "0.1",
 "raft_expansion": "1.5",
 "raft_first_layer_density": "90%",
 "raft_first_layer_expansion": "2",
 "relative_bridge_angle": "0",
 "retract_after_wipe": [
  "0%"
 ],
 "retraction_distances_when_ec": [
  "10"
 ],
 "role_based_wipe_speed": "1",
 "scarf_angle_threshold": "155",
 "scarf_joint_flow_ratio": "1",
 "scarf_joint_speed": "100%",
 "scarf_overhang_threshold": "40%",
 "seam_gap": "10%",
 "seam_slope_conditional": "0",
 "seam_slope_entire_loop": "0",
 "seam_slope_inner_walls": "0",
 "seam_slope_min_length": "20",
 "seam_slope_start_height": "0",
 "seam_slope_steps": "10",
 "seam_slope_type": "none",
 "separated_infills": "0",
 "set_other_flow_ratios": "0",
 "single_extruder_multi_material_priming": "0",
 "single_loop_draft_shield": "0",
 "skeleton_infill_density": "25%",
 "skeleton_infill_line_width": "100%",
 "skin_infill_density": "25%",
 "skin_infill_depth": "2",
 "skin_infill_line_width": "100%",
 "skirt_speed": "50",
 "skirt_start_angle": "-135",
 "skirt_type": "combined",
 "slice_closing_radius": "0.049",
 "slicing_mode": "regular",
 "slicing_pipeline_plugin": [],
 "slow_down_layers": "0",
 "small_area_infill_flow_compensation": "0",
 "small_area_infill_flow_compensation_model": [
  "0,0",
  "\n0.2,0.4444",
  "\n0.4,0.6145",
  "\n0.6,0.7059",
  "\n0.8,0.7619",
  "\n1.5,0.8571",
  "\n2,0.8889",
  "\n3,0.9231",
  "\n5,0.9520",
  "\n10,1"
 ],
 "small_perimeter_speed": [
  "50%"
 ],
 "small_perimeter_threshold": [
  "0"
 ],
 "small_support_perimeter_speed": [
  "50%"
 ],
 "small_support_perimeter_threshold": [
  "0"
 ],
 "solid_infill_direction": "45",
 "solid_infill_rotate_template": "",
 "sparse_infill_acceleration": [
  "100%"
 ],
 "sparse_infill_filament_id": "0",
 "sparse_infill_flow_ratio": "1",
 "sparse_infill_rotate_template": "",
 "sparse_infill_smooth_factor": "0%",
 "spiral_finishing_flow_ratio": "0",
 "spiral_mode_max_xy_smoothing": "200%",
 "spiral_mode_smooth": "0",
 "spiral_starting_flow_ratio": "0",
 "staggered_inner_seams": "0",
 "start_end_points": [
  "30x-3",
  "54x245"
 ],
 "support_air_filtration": "1",
 "support_angle": "0",
 "support_bottom_interface_spacing": "0.5",
 "support_chamber_temp_control": "1",
 "support_cooling_filter": "0",
 "support_critical_regions_only": "0",
 "support_fast_purge_mode": "0",
 "support_flow_ratio": "1",
 "support_interface_flow_ratio": "1",
 "support_interface_not_for_body": "1",
 "support_ironing": "0",
 "support_ironing_flow": "10%",
 "support_ironing_pattern": "rectilinear",
 "support_ironing_spacing": "0.1",
 "support_material_interface_fan_speed": [
  "-1"
 ],
 "support_object_first_layer_gap": "0.2",
 "support_object_skip_flush": "0",
 "support_parallel_printheads": "0",
 "support_remove_small_overhang": "1",
 "support_threshold_overlap": "50%",
 "symmetric_infill_y_axis": "0",
 "template_custom_gcode": "",
 "textured_cool_plate_temp": [
  "40"
 ],
 "textured_cool_plate_temp_initial_layer": [
  "40"
 ],
 "thick_bridges": "0",
 "thick_internal_bridges": "1",
 "thumbnails_format": "PNG",
 "time_cost": "0",
 "time_lapse_gcode": "",
 "timelapse_type": "0",
 "tool_change_on_wipe_tower": "0",
 "toolchange_cyclic_first_layer": "0",
 "toolchange_cyclic_order": "",
 "toolchange_ordering": "default",
 "top_bottom_infill_wall_overlap": "25%",
 "top_layer_direction": "-1",
 "top_solid_infill_flow_ratio": [
  "1"
 ],
 "top_surface_density": "100%",
 "top_surface_expansion": "0",
 "top_surface_expansion_direction": "inward_and_outward",
 "top_surface_expansion_margin": "0",
 "top_surface_filament_id": "0",
 "top_surface_fill_order": "default",
 "top_surface_jerk": [
  "9"
 ],
 "travel_acceleration": [
  "10000"
 ],
 "travel_jerk": [
  "12"
 ],
 "travel_speed_z": [
  "0"
 ],
 "tree_support_angle_slow": "25",
 "tree_support_auto_brim": "1",
 "tree_support_branch_angle_organic": "40",
 "tree_support_branch_diameter_angle": "5",
 "tree_support_branch_diameter_organic": "2",
 "tree_support_branch_distance": "5",
 "tree_support_branch_distance_organic": "1",
 "tree_support_brim_width": "3",
 "tree_support_tip_diameter": "0.8",
 "tree_support_top_rate": "30%",
 "unsupported_wall_last": "0",
 "upward_compatible_machine": [],
 "use_3mf": "0",
 "use_firmware_retraction": "0",
 "use_relative_e_distances": "1",
 "volumetric_speed_coefficients": [
  ""
 ],
 "wait_for_temp_on_wipe_tower": "0",
 "wall_direction": "ccw",
 "wall_distribution_count": "1",
 "wall_maximum_deviation": "0.025",
 "wall_maximum_resolution": "0.5",
 "wall_sequence": "inner wall/outer wall",
 "wall_transition_angle": "10",
 "wall_transition_filter_deviation": "25%",
 "wall_transition_length": "100%",
 "wipe_before_external_loop": "0",
 "wipe_inward": "0",
 "wipe_inward_distance": "50%",
 "wipe_on_loops": "0",
 "wipe_speed": "80%",
 "wipe_tower_bridging": "10",
 "wipe_tower_extra_flow": "100%",
 "wipe_tower_extra_spacing": "100%",
 "wipe_tower_fillet_wall": "1",
 "wipe_tower_max_purge_speed": "90",
 "wipe_tower_rib_width": "8",
 "wipe_tower_rotation_angle": "0",
 "wipe_tower_sparse_layers_combination": "0",
 "wipe_tower_type": "type2",
 "wipe_tower_wall_type": "rib",
 "wiping_volumes_extruders": [
  "70"
 ],
 "wrapping_detection_gcode": "",
 "wrapping_detection_layers": "20",
 "wrapping_exclude_area": [],
 "z_offset": "0",
 "zaa_dont_alternate_fill_direction": "0",
 "zaa_enabled": "0",
 "zaa_min_z": "0.05",
 "zaa_minimize_perimeter_height": "35"
};
