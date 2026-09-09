#!/bin/sh
set -eu
PYTHON=${PYTHON:-python3}
NODE=${NODE:-node}

$PYTHON test_kobra_models.py
$PYTHON test_s1_info_state.py
$PYTHON test_s1_slots.py
$PYTHON test_kobra_gcode_compat.py
$PYTHON test_target_file_preparation.py
$PYTHON test_fork_update_safety.py
$PYTHON test_cors_policy.py
$PYTHON test_control_input_bounds.py
$PYTHON test_print_route_compatibility.py
$PYTHON test_print_pending.py
$PYTHON test_mqtt_framing.py
$PYTHON test_mqtt_ack_correlation.py
$PYTHON test_upload_progress.py
$PYTHON test_log_redaction.py
$NODE test_farm_model_compat.js
$NODE test_file_browser_safety.js
$NODE test_flow_farm_ui.js
$NODE test_farm_dispatch_safety.js
$NODE test_farm_status_persistence.js
