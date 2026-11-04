"""
Purpose: Export the optional release "starter packs" (recipe book + generic maintenance
    library) from the owner's LIVE database into release_files/starter_packs/*.json, plus a
    REVIEW.md listing every generalised / dropped item for the owner to veto.
Version: v1 (2026-09-24)
Scope: STANDALONE UTILITY - release tooling; stays in the repo, is NOT shipped, is never
    imported by the app.
Architecture: Reads vessel_local.db strictly READ-ONLY (sqlite3 URI mode=ro; never imports
    data.py, which opens write connections). Generalisation is deterministic and re-runnable:
    a curated per-task override map (OVERRIDES, keyed by the live task_id: new name /
    description / caution notes, or DROP with a reason) plus a device rename/drop map and a
    few regex clean-ups. Output is consumed by the shipped load_starter_pack.py.

Usage (from the repo root):
    python scripts/release/export_starter_packs.py [--db PATH] [--out release_files/starter_packs]
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

LIVE_DB = "<your-project-dir>/vessel_local.db"
PACK_FORMAT = "mx-inv-starter-pack"
PACK_VERSION = 1
SCHEMA_VERSION = 35
HAULOUT_PROJECT_ID = 5

# ---------------------------------------------------------------------------------------
# Per-task overrides. O(task_id, n=name, d=description, c=caution, sub=[(old, new), ...])
# replaces only the fields given ("" = clear the field). X(task_id, reason) drops the task
# (and, for a checklist, all of its steps).
# ---------------------------------------------------------------------------------------
OVERRIDES: dict[int, dict] = {}
DROPS: dict[int, str] = {}


def O(task_id: int, n: str | None = None, d: str | None = None, c: str | None = None,
      sub: list[tuple[str, str]] | None = None) -> None:
    ov = {}
    if n is not None:
        ov["name"] = n
    if d is not None:
        ov["description"] = d
    if c is not None:
        ov["caution_notes"] = c
    if sub:
        ov["sub"] = sub
    OVERRIDES[task_id] = ov


def X(task_id: int, reason: str) -> None:
    DROPS[task_id] = reason


O(2, c="Drop and re-set the clutch a few times to feel for smooth progressive grip. If it slips loaded or will not free-fall, strip and clean the cones - do not just tighten the clutch nut, that masks worn cones and shears keys. Dual-chainwheel windlasses: both chainwheels and the warping drum often share one common shaft, each coupled by its own clutch. Before powering one chainwheel (or the drum), back the OTHER chainwheel's clutch nut off - a clutch left tight is still coupled and will pay out or haul in that rode uncontrolled. Confirm against your windlass manual.")
O(6, c="Check level at the sight glass; top up with the windlass maker's specified EP gear oil (typically SAE 90). A dropping level means a shaft seal is weeping - track it before the box runs dry.")
O(13, d="Twist off the clear plastic strainer bowl, pull out the mesh screen, and flush out accumulated sediment.", c="Twist off the clear strainer bowl, pull the mesh screen, flush. A blocked strainer starves the pump - it runs hot and loud and diaphragm life drops.")
O(20, c="The winch maker's gear grease on gear teeth and bearings ONLY. Light machine oil on the pawls and springs - NEVER grease the pawls; a greased cold pawl sticks and the winch back-winds under load, throwing the handle.")
O(22, n="Winches - Powered Winch Power & Control-Bus Inspection", d="On powered winches, check that the heavy motor power lines and the thin control-bus cables plugged into the winch control unit are tight and corrosion-free.", c="The winch power supply may step the house voltage up for the motor; supply, control unit and buttons often talk over their own bus, which must NOT be spliced to the boat's NMEA 2000. Check the time-delay fuse on the feed, the power cables for tight lugs and heat, and read the status LEDs. Confirm the supply's input voltage against its label.")
O(26, c="A drop of light oil on the front bearing seam quiets a squeal for a while, but a squealing fan motor is near end of life - keep spare units aboard rather than nursing them; many small fan motors are not really serviceable. Quarterly lube fits between a monthly grille blow-out and a six-monthly deep clean.")
O(37, c="50-hour break-in change - the first oil carries the most seating debris. Use the oil grade in the engine manual (commonly API CD or higher, SAE 10W-30 or 15W-40). Oil filter: hand-tight to seal contact then about +3/4 turn. Change the transmission gear oil at the same time if the gearbox manual calls for a break-in change.")
O(41, c="Common-rail injectors will not tolerate water or dirt - drain the primary separator daily and replace both the primary element and the engine secondary filter at the manual's interval (commonly 250 h). Bleed with the filter-mounted hand primer until fuel runs bubble-free; never crack a line at the rail.")
O(42, c="Carry 2+ spare impellers plus cover gaskets/O-rings and spare screws. Count the vanes of the old impeller - any missing piece is downstream in the heat exchanger and must be recovered. Fit the new one with glycerine or dish soap, never petroleum grease. If a sink drain outlet sits forward of the raw-water inlet, look for grease or food debris in the vanes and strainer, not just sand and salt.")
O(43, c="Some modern common-rail engines have no heat-exchanger pencil zinc and rely on bonding instead - check the engine manual (and the exhaust mixing elbow). If there is none, this task becomes: verify the engine's bonding strap is intact and inspect the HX end tanks and mixing elbow for internal corrosion - the block then relies on the hull bonding-plate anodes and the shaft zinc.")
O(44, c="Use the engine maker's long-life coolant on its stated cycle (typically 2 years; 1 year for conventional coolant). Cooling-system corrosion is behind a large share of diesel failures - do not stretch it. Refill slowly with the thermostat housing highest, run to temp with the cap off to purge air, then top up.")
O(53, c="Check whether your engine-room blowers start automatically with the engine. On a diesel boat there is no need to pre-run them; once the engine is running, confirm they are on: you can hear them, and a hand over the exit hose confirms the outlet fan is moving air. (On a boat carrying gasoline, ALWAYS run the blowers before starting.) Confirm the blower voltage on the nameplate matches the circuit. Also check the intake duct has not slumped toward the bilge water.")
O(56, d="Remove the compass housing from the top of the pedestal. Apply a small amount of grease to the main wheel shaft needle bearings.", c="Lift the compass off the pedestal head and grease the wheel-shaft needle bearings with waterproof marine grease, sparingly. A dry bearing here feels like notchy steering and slowly wears the shaft.")
O(58, c="Wire/chain: run a rag over the wires for meat-hooks, check the chain-to-wire links, and set quadrant tension so there is no slack at centre but the chain still seats on the sprocket. Carry a spare cable made up to length. After new cables are fitted, re-tension and re-check the swages after the first season of use, then on the normal cycle.")
O(60, c="Check the rudder-trunk packing / lip seal for weeping when backing hard under power (worst-case load). A few drops is acceptable on a stuffing type; a stream is not. Know where the gland-adjusting tool lives. After a repack, early weeping usually means the new packing has bedded in and wants a nip, not that it is worn.")
O(62, c="Drop the rudder at haul-out to check upper and lower bearings for ovalisation and play and the stock for crevice corrosion at the bearing lands. On an older hull, budget for this - a failed lower bearing lets the blade wander and can crack the tube.")
O(63, c="New standing rigging stretches: track constructional stretch over the first ~50 miles and re-tune. On an older spar, watch the mast and boom for fatigue, not just the wire.")
O(64, c="Check lower swages for hairline cracks and single broken strands ('meat-hooks'); look for rust bleed weeping from any fitting. Mechanical (Sta-Lok / Norseman type) terminals are the field-serviceable ends - know which of your terminals they are. Any insulators in a stay (e.g. an SSB backstay) sit in the structural load path: inspect them as structural terminals every time this audit runs, and give them a deeper check with the rig slack at haul-out - a cracked insulator core still drops the stay.")
O(66, c="Inspect tangs, spreader tips, rivets, vang attachment and gooseneck for cracks or loose fasteners. On an older spar treat these as fatigue points even when the wire is new - re-rigging does not renew the tangs, spreader bases or extrusion.")
O(67, c="Check the sub-deck chainplate tie-rods and the saloon cabinetry pass-throughs for weeping rust or moisture tracks. Any stay deck collar tied down below deck (e.g. an inner forestay) is another deck penetration; check it for weeping / movement at the same time.")
O(68, c="In calm conditions back the threads off slightly, clean the salt paste, inspect the internal threads, and re-apply Lanocote/Tef-Gel anti-seize before re-tensioning and re-securing the locking. Include any below-deck rigging screws (e.g. an inner-forestay deck tie-down) - same routine.")
O(70, c="Retirement wall: ~10 years for wire, 5-7 for solid rod. New wire resets this clock; the spar does not. Non-negotiable for blue-water safety.")
O(73, c="Check horizontal seams and batten pockets for broken, frayed or UV-rotted stitching. Restitch with V-92 / V-138 UV-bonded polyester thread. A sail that has spent a long time folded in storage also needs a check of fold-line creases and mildew in addition to the usual UV/age wear.")
O(76, d="Send to a sail loft for an industrial wash, hot-knife thread trimming, patch reinforcements, and draft-shape evaluation.")
O(78, c="Check the masthead exits, rope-clutch grip zones and genoa-sheet car splices; inspect the lock-stitches on every splice. Line re-used from an earlier boat or refit carries prior service hours - retire it on condition (stiffness, fuzz, core-shot, clutch flat-spots), not on the age clock. Keep a written line plan (which line, where it runs, new vs re-used, approximate age).")
O(83, c="Retire halyards and sheets on a schedule, not just on visible failure - a core-shot halyard looks fine in the cover right up until it parts under a loaded genoa in a squall. Stiff, faded, fuzzed or clutch-flat-spotted = done. Keep one full-length spare halyard aboard. Re-used line of uncertain age: retire on condition, not on the age clock.")
O(93, c="Some keel coolers have no pencil/collar anode; protection is then a bonding wire from each cooler to the ship's bonding grid plus the hull bonding-plate anode. For those, this task = verify each cooler's bond is intact and reads under ~1 ohm to the bus, and that the hull anode protecting them is not wasted. Where there is a zinc, replace it at ~50% wasted.")
O(123, c="Typically a short 3/4\" NPT magnesium anode taking a 1-1/16\" socket - confirm the right part for your heater. Check often - once the anode is gone the tank corrodes.")
O(124, c="Never energize the element with the tank dry or air-locked - run every hot tap until flow is steady first; trapped air burns the element out in seconds. Replace with the heater maker's element (match wattage and voltage on the label).")
O(127, n="Power Electronics - Remote Monitoring Sync Audit", d="Open the power system's remote monitoring dashboard (the monitoring hub's cloud portal, if you have one) and check for unprompted device disconnects, tracking errors, or historical low-voltage alarm logs.", c="Scan for device drop-outs, comms errors and gaps in the history graphs - an inverter or solar controller that keeps falling off its data bus is usually a loose data cable or a failing RJ45, and you want that fixed before it is the reason the batteries did not charge on passage. Confirm the alarm and generator auto-start logic still test-fire.")
O(128, n="Power Electronics - Inverter & Solar Controller Fan Cleaning", d="Use compressed air to blow accumulated dust or lint out of the cooling fans on the inverter-charger and high-amperage solar charge controllers to prevent thermal throttling.", c="Blow the dust out of the inverter-charger and solar controller cooling fans - a fouled fan derates the unit under load (you lose inverter output or charge current exactly when you are pushing it) and the bearing eventually seizes. Confirm the fans spin up under load.")
O(130, n="Power Electronics - DC-DC Converter Thermal Clearout", d="Inspect the aluminium heat-sink fins on the DC-DC converters. Isolated converters run hot - clear away any surrounding gear that blocks passive convective airflow.", c="Passively cooled DC-DC units can run >140F; keep about 4\" vertical clearance and clear the dust.")
O(132, d="Use a calibrated torque wrench to verify that all heavy M8/M10 connection studs (bus bars, inverter-charger inlets, battery-protect poles) remain tight.")
O(133, n="Power Electronics - Firmware Update", d="Use the manufacturer's app or remote portal to pull firmware updates for the monitoring hub, inverter-charger and solar controllers to patch communication bugs.", c="Update the solar controllers, converters and inverter-charger first; update the monitoring hub last - updating the hub mid-sequence can drop its data buses. Re-check the main DC fuses afterward.")
O(136, c="A large crash pump (4000 GPH class) pulls 15-20 A under load - it needs a correctly sized fuse (about 25 A) and 10-8 AWG wire; undersized wiring drops voltage and output badly. Smooth-bore discharge hose only (corrugated costs up to 40% flow).")
O(150, c="Use the pump maker's black-water diaphragm/valve kit (nitrile for odor containment). On reassembly the central backing plate's rounded edge must face the diaphragm - a sharp edge slices it open within a month. No 90-degree elbows straight on the barbs. Never run liquid bleach or caustic cleaner through the heads (warps the tricuspid valves).")
O(156, d="Test terminal joints for corrosion or resistance drops. Confirm the correctly rated fuse is fitted.", c="Confirm the pump's voltage and fuse rating from its label. Check terminal joints for corrosion and voltage drop under load.")
O(157, c="Run hot water down the drain the pump serves for a minute monthly - it melts the body-oil, soap and hair mat that cements the diaphragm chamber and the tricuspid valves. A diaphragm pump passes solids but not a grease plug.")
O(161, d="Check positive and negative wire crimps for salt-air oxidation. Confirm the supply line is protected by its correctly rated fuse.", c="Confirm the pump's voltage and current draw from its label and size the fuse to match. Check the crimps for salt oxidation.")
O(164, c="Full open-close-open on every seacock monthly, afloat and hauled. A composite ball valve that has not moved in months needs real force - that is when a handle snaps. Keep the boat's whole thru-hull count and locations on a card at the companionway. Include any hard-to-reach valves (e.g. cockpit scupper seacocks) - they are the most likely to seize unnoticed and the easiest to skip.")
O(166, c="Marelon/composite valves: pure silicone grease only (the valve maker's lubricant). Petroleum grease, white lithium and WD-40 swell and split the composite. Composite valves are electrically inert - keep them off the bonding circuit. Bronze valves with a grease path: service them with this task too.")
O(179, n="Solar Panels - Bifacial Panel Clean", d="Clean the underside of bifacial panels and polish the white deck or arch surfaces below them to maximize rear-side bounce light reflection.", c="Bifacial panels harvest off the underside - keep wiring, antennas and shadows off the back face.")
O(181, c="Check any inline MC4 blocking diodes. Keep rigid and flexible (CIGS) strings on separate solar controllers so one string does not bottleneck the other.")
O(184, d="Re-torque the high-current DC output terminals on the solar charge controllers to prevent terminal arcing from cyclical heating expansion.", c="Re-torque the controller DC terminals to that unit's spec (small controllers are often around 2.4 Nm; larger units differ). Cyclical heating backs a lug off over a year and it then arcs under charge current. Hand-feel or thermal-scan the terminals after an hour of good sun.")
O(186, d="Inspect your primary anchor swivel and backup shackles for thread backing, micro-cracks, or bent pins.", c="All-stainless chain piled deep in a damp, low-oxygen locker is prone to hidden crevice-corrosion pinholes, so aggressive fresh-water flushing is mandatory. A stainless swivel on a galvanized anchor or chain is a strong galvanic cell that strips zinc from the shackle and top links - inspect those closely.")
O(190, d="Inspect the chain-to-rope splice on the backup rode for structural stiffness, inner strand unlaying, or hard friction spots.", c="Typical: 8-plait nylon spliced to chain; 316 cotter pins or seizing wire on the shackles.")
O(208, d="Wipe the small integrated solar panel on top of the dinghy navigation light to ensure dried salt spray isn't blocking solar cell absorption.", c="Wipe the solar cell on the dinghy nav light - a salt film cuts the charge and the light will not last the night, which is exactly when you are running back to the boat.")
O(210, d="Scrub the dinghy's tubes to remove exhaust soot and buff on a high-grade UV protectant to prevent the fabric from breaking down or getting sticky.", c="303 Aerospace Protectant (or similar) on Hypalon. No pressure washer on an outboard, especially an electric one - it drives water past the lip seals and can flood the motor.")
O(213, n="Dinghy - Knock-Apart Anchor Hardware Care", c="Coat the knock-apart anchor bolt threads with Tef-Gel or WD-40 before packing it in its bag - damp threads seize from crevice corrosion.")
O(226, n="VHF Radios - Remote Mic Water-Clearing Flush", d="If a wave washes over the cockpit station, run the radio's water-clearing (speaker vibration) function, if it has one, to clear trapped water from the mic speaker grille.", c="Run it after every washdown. 303 Protectant on the coiled remote-mic cord - UV fissures in the jacket wick water into the DSC distress buttons.")
O(227, d="Unbolt the PL-259 coaxial antenna connector at the back of each fixed VHF radio to check for white salt oxidation on the copper pin.", c="Unmake the PL-259 at each fixed radio and at the antenna base, check for green/white oxidation and water ingress, remake with fresh connectors and self-amalgamating tape over the joint. Corroded coax raises SWR, the radio folds back power to protect its finals, and your range quietly halves. After a refit check both ends - a new masthead run may still meet old deck-to-radio tails.")
O(228, c="Program every fixed radio with the vessel's 9-digit MMSI. If an AIS or radio was re-used from a previous boat, CONFIRM its static data (MMSI, ship name, ship type, LxB dimensions, GPS antenna offsets) was re-programmed for this boat and is not still broadcasting the old one. See the AIS task.")
O(230, c="Never key a mic to transmit with no antenna connected - reflected RF melts the PA output transistors instantly. Record a baseline SWR reading when the antenna is new. If AIS shares this antenna through a splitter, an SWR problem hits both.")
O(231, d="Discharge your handheld VHF battery completely and recharge it to verify full capacity, and apply silicone grease to its casing seals.", c="Keep a charged spare handheld battery. On an older handheld the battery is the weak point; run the capacity test on schedule and price a replacement before a long cruise.")
O(232, d="Check the controller faceplates (or the maker's smartphone app, if it has one) to verify the units are actively pulsing.", c="Ultrasonic antifoul only deters new larval settlement - it cannot remove existing growth. Never switch off the controller breakers while away; keep the solar charging live to carry the 24/7 draw.")
O(238, c="Pull the transducer head before any long absence and fit the blanking plug - barnacles lock the paddlewheel and seize the sleeve. On refit, the moulded arrow points dead forward. Depower first.")
O(241, n="Depth, Speed & Temp Transducer - App Calibration & Firmware Check", d="If the transducer has a maker's Bluetooth app, connect to it to verify attitude pitch/heel calibration and pull internal system logs.", c="Verify the pitch/heel (attitude) offsets still match how the transducer sits in the hull, and note the firmware version. A drifted attitude offset throws the speed and depth corrections. Do it hauled or at rest.")
O(242, c="Check the Micro-C tee and drop cable to the transducer for a tight lock-ring and clean pins - a marginal drop connector browns the pins, the sensor drops off the bus intermittently, and you chase a 'bad transducer' that is really a cheap cable. Confirm the backbone is powered and terminated both ends.")
O(243, n="Wind Sensor - Gateway LED Status Check", d="If the wind sensor reaches NMEA 2000 through a gateway / bridge, verify its indicator lights show healthy network traffic (typically slow, steady green).", c="A fast flash or amber usually means the bus is not seeing the masthead unit or is not terminated. A dead wind instrument on the first night of a passage is a watch-keeping problem.")
O(245, d="Disconnect and clean the masthead wind connector at the arm base to prevent salt air tracking.", c="Check the gateway's port current limit before adding devices to it. Push/pull connectors must never be twisted - twisting snaps the pins.")
O(246, d="Open the mast-base junction box where the bare mast wires are terminated. Check for loose or shorted wire-to-terminal crimps.", c="Carry a spare field-installable connector. Push/pull connectors only - never twist.")
O(247, n="Wind Sensor - Gateway Firmware Update", d="Update the wind gateway's firmware via an NMEA 2000 chartplotter or the maker's PC software to patch communication bugs.", c="Makers push fixes for translation bugs that cause intermittent wind drop-outs. Note the version. Never twist push/pull connectors.")
O(249, d="Verify that the structural bolts securing the autopilot drive's backing base to the hull stringers remain tightly torqued.")
O(251, d="Engage the autopilot to verify the pilot computer is delivering a steady clutch voltage to lock the drive's clutch. If it drops current, the clutch slips under heavy wave loads.", c="Check the clutch-circuit current limit on your pilot computer - an older drive paired with newer electronics can spike past it and cook the board; fit an inline automotive relay if the current climbs. Note where the motor controller is installed.")
O(252, d="Verify your rudder reference transducer (linear or rotary) tracks true without physical linkage binding or loose ball-joints.", c="Confirm the rudder-reference arm moves the full range without binding and reads centre when the rudder is centred - a drifted or stiff feedback unit makes the pilot hunt or hold a permanent few degrees of helm. Re-zero after any steering work.")
O(253, d="Back off the rear cap of the autopilot drive motor to blow out black carbon brush dust before it builds up and shorts the motor.")
O(254, n="Autopilot - Heading Sensor Re-Calibration", d="If major steel gear, dive tanks, or spare anchors have been shifted near the autopilot's heading sensor / course computer, run a compass re-calibration swing.", c="Re-run the pilot's compass calibration if heavy ferrous gear (dive tanks, spare anchor, tools) has moved near the heading sensor, or if the pilot's heading disagrees with the ship's compass. The sensor drifts with nearby iron and then steers a curve. Know where the sensor is mounted and judge nearby-iron risk against that spot. Hybrid systems (newer control electronics driving an older drive unit) are common - note which part is which.")
O(260, c="Many small watermakers use 2.5 x 40 in seawater RO elements - confirm the size and count in your watermaker manual. RO elements typically last 2-5 years.")
O(262, c="Level between MIN and MAX before each session and every 5 running hours - a small dive compressor works hard for its size and a low level cooks the upper stages. Use only the maker's specified synthetic oil. Darkening fast = blow-by; milky = moisture past the separator.")
O(265, c="The maker's synthetic compressor oil; filter cartridges; a spare drive V-belt.")
O(268, c="A single-phase 110V compressor motor can pull ~30 FLA - it needs a dedicated 30-40 A breaker on 10 AWG, never a shared 15 A cabin outlet. Start it with the generator online or on 30 A shore power; the inductive surge may not start off batteries.")
O(287, d="Return the raft to a service station authorized by the raft maker for full pressure tests, gas cylinder weighing, and survival pack consumable replacement.", c="Maker-authorized station: full inflation/pressure test, cylinder weigh, expiry replacement of flares/rations/water, repack. Book early - stations back up before hurricane season, and an out-of-cert raft is not one you can rely on or clear a rally with.")
O(294, c="Vacuum the condenser grille and coil. A swing compressor shrugs off heel and rough use but not a heat-blanketed condenser - a blocked coil makes it cut out on thermal overload. If the unit was carried over from a previous boat, factor its real age into service expectations.")
O(295, c="Check the lid gasket and the over-centre latches - the seal and latch tension do the sealing. A soft latch or a compressed gasket lets the box sweat and it runs non-stop. Adjust the strike; carry a spare strike plate.")
O(296, c="Pull the wire basket and wipe the sump - spills pool under the basket and freeze. Baking soda and warm water, dry before re-powering.")
O(297, c="No sharp tools in the box - a pierced evaporator wall is fatal to the unit.")
O(298, c="Many portable fridges auto-prioritize AC over DC when both are present. Keep the DC plug and socket contacts clean - voltage drop here stops it cycling.")
O(299, c="Layup: clean, dry, lid cracked on its vent latch, both DC and any AC cord unplugged. The thermal-fuse DC cord is a wear item - carry a spare.")
X(305, "Owner's custom DIY ceramic-bearing companionway rail - not a general task")
O(313, d="Start the main engine and the generator to confirm each raw-water flow sensor drops its alarm state once cooling water moves the internal paddle.", c="Start each engine and confirm the flow sensor drops its no-flow alarm within seconds - and at the dock, close a seacock and confirm it RAISES the alarm. A flow alarm that only ever shows OK may be failed the wrong way. Check the sensor is sized for your plumbing.")
O(314, c="The fire-suppression discharge relay must cut power to the main engine fuel solenoid and the generator stop circuit mechanically, independent of any software - a running diesel inhales the clean agent and renders it useless.")
O(317, d="Inspect the wiring blocks on the engine room heat sensor to ensure no vibration loosening or terminal corrosion at the screw terminals.", c="Check the wiring blocks at the ER heat sensor for vibration-loosened or corroded terminals - a heat sensor with a bad connection just reads 'no alarm' forever. Wiggle-test with the engine running.")
O(328, n="Temperature Sensors - Signal & Data Audit", d="Open the monitoring dashboard (app or monitoring hub) and check for any wireless temperature sensor disconnects or low-battery warnings.", c="Check every wireless tag is still reporting and none flags low battery - a dropped tag is flat, out of Bluetooth range of the receiver, or shut inside a metal box (the freezer) attenuating 2.4 GHz. These are the early warning for a fridge / freezer / bilge problem, so a silent tag matters.")
O(329, d="Open the weatherproof enclosure of any sensors deployed in harsh areas (like the freezer box or deep bilge) to ensure there is no internal condensation.")
O(330, d="Wipe down the sensor housings with a dry cloth to clear away sticky salt crusting that can block or attenuate the 2.4 GHz radio signal.")
O(333, c="More than slight tip play means the bevel gears inside the hub are worn - send it to the prop maker or its service agent before it strips at sea. Check every blade; wear is usually uneven.")
O(334, d="Pump the prop maker's waterproof grease into the hub zerk until fresh grease purges past the blade seals.", c="On a feathering prop this is THE maintenance job. A hub that runs dry seizes, loses feathering and wears the gears. Every haul-out minimum; more often in the tropics. Use the maker's grease or a fully water-resistant marine grease - never a lithium/EP grease that emulsifies.")
O(335, d="Replace the feathering prop's cone/hub zinc (or aftermarket collar zinc) at haul-out or when more than ~50% wasted.", c="A feathering prop with no anode dezincifies the bronze hub gears - an expensive rebuild. Warm salt water can consume the small hub anode in 6-8 weeks, so dive and check it between haul-outs. Also tracked under Bonding & Cathodic Protection.")
O(336, d="Confirm all blades are set to the same pitch and that it matches the last prop service sheet.")
O(337, n="Propeller - Line Cutter Service", d="At haul-out: dress or replace the rotating line cutter's blades (sharp, no chips), check the blade bolts and the body clamp screws are tight and wired, confirm the body is clocked so the blades clear the strut and cutless bearing, and check the cutter's integral zinc - renew it if it is past ~50%.", c="Cutter blades chip on wire and hard debris and go dull; a dull cutter wraps line instead of slicing it. The cutter zinc wastes fast in warm salt water - check it every dive, not just at haul-out, and keep a spare blade/zinc kit unopened. Record the cutter size and part numbers on the prop card.")
O(338, c="Warm salt water eats a shaft zinc in 60-90 days. A missing shaft anode dumps the whole galvanic load onto the prop hub and the cutless-bearing area.")
O(339, n="Bonding & Cathodic Protection - Prop Hub Anode Check", d="Inspect / replace the feathering prop's hub anode (the primary task lives under the Propeller system) - listed here so the whole anode set is checked together.")
O(342, d="Replace the hull-mounted plate / teardrop zinc(s) wired to the green bonding bus. Size and count per the builder's bonding schematic.")
O(343, d="Pull and inspect the generator heat-exchanger pencil zinc.")
O(344, d="Pull and inspect the main engine heat-exchanger pencil zinc (also flagged at 250 h under the engine system).", c="Some modern common-rail engines have no HX anode and are bonding-protected (check the exhaust mixing elbow too). If there is none, this task is: confirm the engine bonding strap and inspect the HX / elbow for internal corrosion. The block then relies entirely on the hull bonding-plate anodes and the shaft zinc - so those matter more.")
O(349, d="Use the gear oil in the transmission manual (commonly API CD+ SAE 20 or 30 straight-grade, 15W-40 often acceptable), filled via the dipstick tube. Many small marine gearboxes are splash-lubricated with no oil filter.")
O(351, c="A cone clutch (common on small marine gearboxes) is not field-adjustable like a band clutch - slip or creep means worn cones and a haul-out rebuild. Catch it early from the oil and the feel, not after it fails leaving a dock.")
O(361, c="Standing bilge water at an aluminium mast heel is a slow structural killer - keep that area bone dry. Corrosion at the heel eats section where the whole rig load lands; catch it while it is surface pitting.")
O(362, d="For the first two hauls after relaunch following below-waterline work, re-verify the bedding and seals of every thru-hull, the shaft log / cutless housing, and every transducer (antifouling, depth/speed) for weeping or a chalky seal.", c="Below-waterline hull work disturbs everything. A fitting re-bedded during a refit can still weep as the sealant cures and the laminate re-stabilises - the first two seasons are when it shows.")
O(364, d="Annual internal/external visual inspection of every cylinder (PSI/PCI standard); fresh VIP sticker applied.")
O(365, c="A cylinder past its 5-year hydro cannot legally be filled. Hydro facilities are scarce in many island chains - schedule this for a stop with a test facility and stagger the tanks so you are never grounded. Budget that an aluminium 80 may fail and need replacing at ~20-25 years.")
O(372, c="Same reasons as the generator: condensation in the crankcase and exhaust, fuel gumming in the injection system, the raw-water impeller taking a set, a damp alternator. A common-rail engine especially does not like stale fuel sitting on the injectors. Get it hot enough that the thermostat opens - a short cold run leaves more water behind than it burns off.")
O(379, n="Tank Monitoring & Senders - Tank Sender Calibration (first fill / after tank work)", d="Multi-point calibrate every fuel and water tank sender: fill from a known-low or empty state in measured increments, record the raw sender value against actual gallons at each step, and enter the calibration curve in the tank monitor.", c="Tanks with sloped bottoms make a 2-point (empty/full) calibration badly wrong in the middle, which is exactly where you make decisions on passage. Take at least 5-6 points per tank. Do it on the FIRST fill (or after any sender/tank work) and log the curve so it can be re-entered if the monitor is replaced. Note total usable capacity vs nameplate - the pickup does not reach the last few gallons.")
O(380, d="Compare the tank monitor's readings against a physical dip or sight tube, and against fuel actually burned (engine + generator hours x consumption). Investigate any tank that has drifted.")
O(391, d="Before every dive: inspect and lightly grease the main housing and port O-rings, check the sealing groove for a single hair or grain, close up and run the vacuum/leak alarm if the housing has one; watch it on descent.", c="One hair on the O-ring floods the housing and the camera is gone. Never dive a housing you have not personally sealed and vacuum-checked that day. Carry spare O-rings and silicone grease for every housing and port.")
O(393, d="Inventory the dinghy repair kit (tube fabric, patches, valve wrench, spare valve) and REPLACE the adhesive annually - it is a consumable with a hard shelf life.", c="Know your tube fabric: Hypalon/CSM tubes need a 2-part CSM adhesive and PVC cement will not hold; PVC tubes need PVC adhesive. Two-part glue is dead roughly a year after mixing and weeks in a hot lazarette, so buy fresh and date it. Carry enough fabric and patches for a hand-sized tear on one tube. Practice a dry patch once so you are not learning it in the water.")
O(394, c="Use the pressure printed on the tube (often about 3.4 psi / 250 mbar) - soft tubes flex the hull joint and pound in chop; over-pressure in the sun splits a seam. Inflate in the shade and top up as it cools. A weeping valve is the most common slow leak and is a 2-minute O-ring fix. Keep spare valve inserts and O-rings in the repair kit.")
O(395, c="The tube-to-hull glued seam and the transom are where a RIB fails with age and sun - run a fingernail along the seam looking for lifting edges. A missing or perished drain-plug O-ring swamps the dinghy on the painter overnight; carry a spare plug. Check the tow eye and davit rings for elongation or crazing before every offshore leg - a let-go while towing is a lost dinghy.")
O(398, c="The Windex is the primary wind reference for short-tacking, picking up a mooring and sailing in light air - a bent vane or a seized bearing quietly costs you boat-handling. Birds and a wrapped halyard are the usual killers. It is a fragile aluminium part you cannot fix at sea, so carry a spare vane (or a whole spare unit).")
O(419, n="Propeller - Line Cutter Dive Check", d="Between haul-outs, dive the shaft: confirm the line cutter's blades are still sharp and undamaged, the body has not shifted on the shaft, and (if fitted) the cutter anode still has metal. Clear any line, weed or barnacle growth from the cutter and the prop gap.")
O(420, c="A dripless seal that runs dry - unburped after launch, or a collapsed / split bellows - cooks the carbon face in minutes, scores or cracks it, then weeps or lets go and floods the boat. The bellows is age-limited: replace it on the maker's schedule (about 6 years for several makers) regardless of how it looks. Record the seal make and model - it sets the bellows interval and the spare part number.")
O(421, c="COLREGS and the insurer both assume these work: a dark boat offshore at night is the classic collision setup, and a mis-wired tricolour/anchor pair (both on, or the wrong one) is a common post-refit fault - check it explicitly. Carry spare modules/bulbs and know the mast-base junction. If the masthead anchor light has a daylight sensor and won't switch off by day or won't strike at dusk, suspect the photodiode/sensor, not the LED.")
O(422, c="A keel-stepped mast sits its base in the bilge zone - the loom and its connector are the first things to corrode, and a high-resistance joint there dims the nav lights and raises VHF SWR.")
O(423, d="Fresh-water flush the furling drum and the halyard-swivel races (many furlers use un-greased Torlon bearings - rinse only, no oil unless the manual says otherwise). Furl and unfurl each sail through its full range and feel for notchiness, grinding or a tight spot; check the drum line is fair on the drum and the foil feeds cleanly.", c="Salt-locked bearings load up the furling line until something parts at the worst moment; for sealed Torlon races the rinse is the whole maintenance plan.")
O(424, c="A foil-connector screw that backs out chews the sail luff tape and can jam the sail half-furled in a blow - the classic offshore headsail emergency. With new foils, re-check after the first hard season.")
X(428, "Interim watch on the owner's open mast-partners defect (tied to his rigger and punch list)")
O(429, d="Confirm the AIS is actually transmitting (have a nearby vessel or a shore AIS site / app confirm your target, or use the maker's configuration tool), holds a GPS fix, and that its STATIC DATA is right - MMSI, call sign, ship name, ship type, length x beam, and GPS antenna offsets. Check the antenna / splitter connections, that the silent-mode switch works, and that the unit is not alarming.", c="Two failure modes worth the periodic check: (1) it silently stops transmitting and you think you are visible when you are not; (2) a firmware reset / re-flash can revert the static data - re-verify after any AIS firmware update. If the unit came from a previous boat, confirm it is not still broadcasting that boat's name and MMSI.")
# --- Next Haulout project (source project 5) ---
X(481, "Owner's own interior refit wish-list item (haul-out project)")
X(482, "Owner's own interior refit wish-list item (haul-out project)")
X(483, "Owner's own interior refit wish-list item (haul-out project)")
X(488, "Owner's specific fridge-conversion plan (haul-out project)")
X(827, "Owner's specific fridge-conversion plan (haul-out project)")
O(716, n="Rigging - Stay Insulator Deep Inspection (mast out / rig slack)", d="If any stay carries insulators (e.g. an SSB backstay), then with the mast out or the rig fully slack pull the insulators apart far enough to inspect the insulator core itself for cracks - the routine in-water audit can only eyeball them under load, which can hide a hairline crack.", c="An insulator sits in the stay's structural load path: a cracked core drops the stay. Skip this if your rig has no insulators.")
O(815, n="Thru Hulls - Replace legacy / suspect seacocks", d="Replace any seacocks that are original, corroded, stiff or of unknown age - hard-to-reach ones (e.g. cockpit scuppers) are the ones most often skipped when the rest are renewed. A haul-out job. Until then, keep exercising them (see Valve Actuation).")
O(867, n="Deck Hardware - Teak grab rails: repair or replace (next haul-out)", d="Grab rails are handholds people put their weight on underway, so a rail that is cracked, rotted or loose at its fasteners is a safety problem, not just a looks problem - push and pull each one hard and stay off any that move. Work out which rails need repair and which need replacing, and check the deck under each base for water in the core when it comes off. Do it with the rest of the haul-out carpentry; the recurring Teak & Foredeck Handhold Check covers the day-to-day inspection until then.", c="")
# --- Engine Start / Shutdown checklist (491) ---
O(491, c="Covers both the main engine and the generator.")
O(492, c="Know where the dipstick is on the main engine and on the generator.")
O(493, c="Check the tank level via the chart plotter, tank monitor or sight gauge first, then set the tank-select valve.")
O(494, n="Fuel system - select fuel filter element", c="If you have a dual (switchable) primary filter, select the element to use. Verify the bowl is clean and no water is present before starting.")
O(495, c="Main engine: select the main engine. Generator: select the generator.")
O(497, c="See the fuel filter element change procedure if it needs priming.")
O(504, n="Start the main engine", c="Power the engine panel on, then press Start - it should crank and start easily. Verify raw water pumping from the exhaust. Verify positive oil pressure and that engine data is displaying. FAILED START - protect the engine from hydrolock. Follow the manual's cranking limit (commonly no more than 15 seconds, with about 15 seconds between tries). With a water-lift (waterlock) muffler, excessive cranking can fill it and push seawater into the cylinders: if the engine has not started after about 10 seconds of cranking, CLOSE the raw-water seacock and crank in short bursts until it starts. When it starts with the seacock closed, STOP the engine immediately, RE-OPEN the seacock, then restart and run normally - it must not run without cooling water (the impeller runs dry within seconds). If water in the cylinders is suspected (hard to turn, very slow cranking), do not crank - call a dealer. Check these numbers against your engine manual.")
O(505, n="Start the generator", c="Start from the generator panel. Verify raw water pumping from the exhaust and positive oil pressure. Once running and stable, turn on the generator breaker at the AC panel. FAILED START - protect the generator from hydrolock: prolonged cranking without a start pumps raw water into the exhaust, which can then run back into the cylinders. If it will not catch: CLOSE the raw-water seacock, drain the exhaust muffler, and find out why it needs so much cranking. Once it starts, IMMEDIATELY re-open the seacock. If the generator runs its own automatic start sequence, learn how many crank attempts it makes; after any failed start, close the seacock before pressing Start again. Hydrolock damage is usually not covered by warranty.")
O(507, n="Shutdown - main engine", c="A turbocharged engine needs a controlled cool-down: idle out of gear for 5-10 minutes first. Stop the engine, then switch off the engine panel.")
O(509, c="Check for leaks. Check the fuel filter bowl condition and clean if needed. Check strainer condition and clean if needed. Check for smoke or odors. Leave the fuel and raw-water systems configured for use, in case of an emergency restart.")
O(640, c="Know your boat's own rules - e.g. if the engine and generator share a fuel system or raw-water strainer, never run both at once. Alternator safety: never turn off a battery switch while an engine is running, or you will destroy the alternator diodes. FAILED START - hydrolock: see the two Start steps for the cranking limits and the close-the-seacock procedure, and check the numbers against your own manuals.")
# --- passage checklists: drop the source-document notes ---
O(510, c="")
O(524, c="")
O(528, c="See the separate Departure Safety Briefing, Preparing to Sail, and Engine Start checklists for the rest of departure day.")
O(537, c="The captain's pre-departure briefing to crew. Each step is a topic group to cover, not a physical task.")
O(552, c="")
O(561, c="")
O(566, c="Raising and setting the anchor - the same procedure, up and down.")
O(578, c="")
O(588, c="")
O(594, c="Approach, clearance and the legal paperwork on arrival.")
O(604, c="")
O(610, c="See the separate Putting Away the Sails checklist for rigging and sails.")
O(617, c="Grab list, not a sequential procedure - each step is one item to have in hand.")
O(628, c="Set to recur every 6 hours to match a 6-hour watch - adjust the period to your own watch schedule.")
O(633, c="The first few minutes after getting underway, before settling into the passage.")
O(511, c="Departure paperwork; arrival fees; required permits/visas; communications requirements (satellite internet, cellular carriers); destination port arrival requirements; whether a local agent is needed; VHF channels in use (16/9, or something else); other local contact details (phone, WhatsApp); reprovisioning considerations on arrival - fuel/water availability, food availability, chandlery availability, sail loft availability, engine and generator repair facilities.")
O(514, c="Macro: general planned route; need for additional crew; weather windows; arrange weather routing if desired; provisioning/menu required. Detailed: program the final route into the chart plotters; zoom in along the route to verify in-transit dangers/risks; send the float plan to your shore contact (cc crew designates if applicable).")
O(523, c="Papers of Record waterproof packet; vessel registration; passports; passage clear-in/clear-out documents; medical documents; eyeglass scripts; permits/visas; insurance documents; wallets/ID for each person; handheld VHF (charged); USB battery pack (charged) with cables for phones and the satellite messenger; first aid kit; prescription meds; cash/credit cards; USB drive with the boat's documents + current boat data backup; sunscreen; survival kit; multitool.")
O(532, c="Ensure the satellite tracker / messenger is mounted and reporting the vessel's position.")
O(533, c="If going offshore, switch the satellite internet plan to its offshore / ocean mode if it needs one.")
O(543, c="Internet usage (email, weather, emergency calls) - offshore data may be metered. Download entertainment content before departure. VHF radio - use AIS to monitor approaching traffic, initiate calls if we'll pass close. The satellite tracker is our tracking mechanism - checked at watch handover.")
O(544, c="Watch length (e.g. 6-hour shifts). Cleaning. Food prep. Passage plan including weather forecast. Designated shore agent has the passage/float plan. Periodic reporting via the satellite tracker.")
O(551, c="If overtaken by a vessel with ill intent, do NOT fight back - surrender immediately if clearly outnumbered/outgunned/outrun. Call a Mayday on VHF, activate SOS on the satellite messenger and AIS, then cooperate with the boarding party. Agree the boat's policy (firearms, valuables) with the crew before departure.")
O(753, d="On a metered offshore link the biggest bandwidth risk is usually not the boat's own systems - it is crew/guest phones and tablets streaming video over the boat WiFi. A single streaming session can burn more data than everything else combined. Brief crew and guests before departure: entertainment underway comes from local media only, not internet streaming.")
O(567, c="Power up the anchor washdown pump; clear mud/grass from the chain before it reaches the chain locker.")
O(568, c="Maintain low-RPM forward gear under engine power to absorb strain and prevent windlass motor overheating while hauling.")
O(717, c="On a dual-chainwheel, single-shaft windlass both chainwheels (and any warping drum) share one shaft, each with its own clutch. Before running EITHER chainwheel (raising or setting), back off the OTHER chainwheel's clutch nut until it stops. If you leave it tightened, it is still coupled to the shaft and will get driven too - paying out or hauling in that anchor/rode uncontrolled while you are trying to work the one you actually intend to use. Skip if your windlass has a single chainwheel.")
O(591, c="Ensure the inverter/charger transitions to its charging state.")
O(616, c="Buy a local SIM / data plan if needed. Select cellular as the router's primary source. Pause the satellite internet plan.")
O(619, n="Satellite messenger / tracker (cockpit)")
O(632, c="Main engine (inspect the engine room); monitoring dashboard review; power systems status; bilge status.")
# --- dropped boat-specific checklists ---
X(670, "Commissioning / break-in checklist reconstructed for the owner's specific engine (rpm figures) - not safe to generalise")
X(683, "Commissioning checklist for the owner's own new rig (his rigger, invoice, punch list)")
X(693, "Commissioning checklist for one specific furler model from its installation manual")
X(706, "Commissioning checklist built from the owner's own refit punch list and line plan")
X(654, "First-time commissioning checklist for one specific watermaker model (wiring, fittings)")
X(729, "Owner's own IT / backup / network deployment checklist")
X(728, "Controls the owner's own backup-sync script")
X(755, "Owner's own sail-configuration update on a collaborator's computer")
# --- watermaker startup / shutdown (641) ---
O(641, c="Typical sequence for a manual needle-valve watermaker - check pressures and flow against your unit's manual. The recurring flush / pickling / filter schedule is tracked as separate maintenance tasks, not repeated here.")
O(642, c="Commonly 20-micron then 5-micron 10\" spun-poly elements. Replace if they look contaminated.")
O(647, c="Keep increasing pressure until the flow gauge reads the unit's rated output OR pressure reaches the maker's maximum (commonly around 900 psi), whichever comes first. Do not exceed the maximum - going higher makes more water but exceeds the normal operating limit.")
O(648, c="Product water should stay under the maker's TDS limit (often 500-600 ppm). If it climbs and stays high, the membrane likely needs replacing (see the membrane task).")
O(650, sub=[("Never exceed 900 psi.", "Never exceed the maker's maximum pressure (commonly around 900 psi).")])
# --- lay-up (759) and return-to-service (782) ---
O(766, d="Judgment call, not a fixed action. Factors: expected absence length, hurricane-season exposure at the layup location, the marina/yard storm plan (if on the hard). If leaving rigged: make sure every furled sail is secured (extra wraps, sheets tight, a lashing round the furled sail). If removing: follow the furler manual's unbend procedure.", c="Taking headsails off the furler before a storm reduces windage - treat this as a genuine storm-risk decision, not routine housekeeping.")
O(767, n="Suspend main engine / generator Idle-Period Run scheduling while hauled out", d="No raw-water cooling available on the hard - do not run either engine. Defer the idle-period run due dates (and anything else that goes overdue) to the actual back-in-service date.")
O(769, n="Verify the seacocks: closable ones closed (A/C exceptions applied), scuppers left OPEN", d="Confirm every closable seacock is closed - except any feeding equipment deliberately left running (e.g. an A/C) - and that the cockpit scuppers are still OPEN. For an extended IN-WATER absence only - not applicable once hauled.", c="Cockpit scuppers stay open - the cockpit has to drain rain. A depth/speed transducer can be pulled and blanked with its plug (optional). Bilge-pump discharges above the waterline usually have no seacock. If an A/C is left running and drains condensate into the bilge, that bilge pump and its float must be known-good.")
O(770, d="Covers every keel-cooled refrigeration unit. Do not run the compressor while hauled - with no water around the keel cooler it destroys the unit almost immediately.")
O(771, c="For a warm-climate haul, securing the unit and leaving the seawater loop dry is sufficient. Where freezing is possible, follow the A/C manual's winterising procedure (antifreeze through the water inlet -> strainer -> pump -> coil -> outlet).")
O(775, n="Anode inspection/replacement - shaft, prop hub, strut, rudder stock")
O(777, n="Keel-cooler service - zinc/bonding audit + chemical descale")
O(779, n="Feathering prop & line cutter service - grease, feathering test, backlash, anode, cutter")
O(783, c="Typical procedure (check your watermaker manual): reconnect the high-pressure hose pump-to-membranes, reinstall the pre-filters, lightly lubricate moving parts, then run the system depressurized on brine (overboard, not into the tank) for a minimum of 30 minutes to flush the pickling solution before switching the product-water hose over to the tank. Repeat the brine flush after every fresh pickling, not just a first-time reactivation.")
O(788, n="Run Engine Start steps (main engine + generator)")
O(794, n="AC condenser/heat-exchanger descaling - all seawater-cooled A/Cs")
X(797, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(798, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(799, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(800, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(801, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(802, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(803, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(804, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(805, "Names one of the owner's own seacocks and its location (covered by the generic 'Verify the seacocks' step)")
X(806, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(807, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(808, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(809, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(810, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(811, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(812, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(813, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
X(814, "Names one of the owner's own seacocks and its location (covered by the generic 'Reopen thru-hulls' step)")
O(819, d="Twist off the clear plastic strainer bowl, pull out the mesh screen, and flush out accumulated sediment.", c="Twist off the clear strainer bowl, pull the mesh screen, flush. A blocked strainer starves the pump - it runs hot and loud and diaphragm life drops.")
O(823, d="Twist off the clear plastic strainer bowl, pull out the mesh screen, and flush out accumulated sediment.", c="Twist off the clear strainer bowl, pull the mesh screen, flush. A blocked strainer starves the pump - it runs hot and loud and diaphragm life drops.")
# --- abandon ship (830) and briefing ---
O(830, c="The SEQUENCE for abandoning ship; the companion 'Ditching / Abandon Ship Grab List' is the list of things to have in hand. Edit it to match your boat.")
O(832, c="VHF (DSC radios): lift the cover, hold DISTRESS for about 3 seconds, wait for the acknowledgment, then MAYDAY on channel 16. Use a laminated VHF radio card with the MAYDAY script, kept at the nav station. Activate the EPIRB (know whether yours has a hydrostatic float-free release that self-activates if the boat sinks). Send a satellite-messenger SOS if you carry one. Give position, souls aboard, raft. Message template: MAYDAY - [vessel name] - [Lat/Lon] - Abandoning ship - [# people] - [raft type + colour] - [time UTC].")
O(833, c="Use the 'Ditching / Abandon Ship Grab List' checklist. Everyone should know where the ditch bag lives. Satellite messenger; phones in waterproof cases; PFD-mounted MOB devices and personal beacons.")
O(835, c="Know your raft's capacity, where and how it is mounted, and its canopy colour (for the MAYDAY). Keep the painter attached and secure to the boat; DO NOT cut it until the vessel is going down and below deck level. Keep a knife near the raft and know where the others are.")
O(839, c="Leave the cabin lights on. Hatches and ports are the skipper's judgement: open for fire or grounding (visibility, nobody trapped), shut for flooding (slows the water, floats longer). Photograph damage if possible. Keep everyone clipped in / tethered to the raft. Hourly position updates by satellite messenger. Ration water.")
O(841, c="Show the crew the engine STOP control, the generator breaker, the raw-water seacock and the hydrolock rule (see the Engine Start checklist), and where the battery master switches are (house bank, house loads, solar, inverter/charger, start batteries). Never turn off a battery switch while an engine is running.")
O(843, c="Explain how the heads work (manual or electric, and that only waste and toilet paper go in), where black water goes and how the tanks are emptied, how the fresh-water pump and water heater are run, and any water-conservation rules aboard.")
# --- Papers & Registrations, first aid, lay-up gaps ---
O(844, n="Vessel documentation / registration - renew", d="Renew the vessel's documentation or state registration before it expires (e.g. a USCG Certificate of Documentation runs 5 years); start about 90 days ahead. Check every printed detail (name, numbers) for errors and get them corrected at renewal. Mark done with the new issue date.")
O(845, n="Ship Station Licence - renew", d="Renew the ship radio station licence where your flag requires one (e.g. a 10-year FCC licence); start about 90 days ahead. Mark done with the new grant date.")
O(846, d="Start about 60 days before the policy period ends. The renewal may need signed proof that the last survey's recommendations were complied with. Mark done with the new policy's effective date.")
O(847, d="NOAA 406 MHz beacon registrations must be renewed every 2 years, and updated whenever boat or contact details change. Mark done with the date the registration was confirmed. Note the beacon battery expiry date as well.")
O(848, n="Passports - renew", d="Many countries require 6 months' passport validity on arrival, so the real deadline is about 6 months before expiry; set this reminder about 3 months before that. Mark done with the new issue date.")
O(849, d="The annual CBP user-fee decal (bought through DTOPS for the vessel's documentation number) is a calendar-year decal: it expires Dec 31 and is needed before re-entering the US from foreign waters. About 60 days before the year ends, buy next year's decal, then mark this task done with its effective date and note the sticker number.")
O(852, d="Open every kit (primary, heads, ditch bag): check the dates on medications, dressings and sterile items, restock what was used, and record what expires next.")
O(854, n="First Aid & AED - AED Battery / Pads Replacement", d="Replace the AED's consumables (battery and pads - some units use a single cartridge holding both) by the expiry date on the label, often about 4 years. Some suppliers track the expiry and email a reminder; replacements can be scarce, so order early. Read the expiry off the label and set this period to match.")
O(861, c="File or update the float plan with your shore contact before leaving.")
O(862, c="An electric water-heater element burns out in seconds if it is powered with no water around it. If the tank is ever drained or the boat is hauled, the breaker must already be off before anyone touches the tank.")
O(863, d="Leave the battery banks connected if solar (or shore power) keeps them up. Turn everything else off and leave only the minimum loads: e.g. bilge pumps, remote monitoring / telemetry, cameras, and (if the boat is afloat) air-cooled refrigeration and a dehumidifier. Keel-cooled refrigeration is covered by its own step and is never run while hauled. Edit this list to match what you actually leave running.", c="Check the bank state of charge before leaving and again on the first remote check-in; the charging source has to out-produce the standing loads in the worst weather expected.")
O(865, n="Decide: anchor chain(s) - leave as is, or inspect / relocate", d="Judgment call. Decide whether to leave the anchor chain(s) stowed as they are, or take them out to inspect (and rinse, if galvanised) before leaving - galvanised chain left wet in a locker can rust into a solid pile. Record the decision and where each chain lives.", c="")
O(866, d="Bare (unoiled) teak on the cockpit and handholds: rinse and gently scrub with a soft brush and mild soap along the grain - no pressure washer. Look for open seams, lifted or missing bungs, cracks and soft or rotted wood. HANDHOLDS: push and pull each one hard; it must not move. Check the fasteners and the bedding under each base for water getting into the deck or core.")
O(869, d="Press the helm switch and confirm the horn sounds.")
O(870, n="Test the hailer through the cockpit VHF")
O(871, n="Chart subscriptions - renewal check", d="Chart-plotter and app chart subscriptions usually renew yearly (often automatically). About 30 days ahead, check the card on file, the price, and whether each subscription is still wanted. Mark done with the renewal date.")
X(874, "Owner's own chart-app subscription (the generic 'Chart subscriptions - renewal check' task covers it)")
# --- second pass: residual specifics found after the first export ---
O(207, d="Rinse the entire dinghy and flush the outboard's lower unit / shaft casing with fresh water to clear salt crusting.", c="Rinse the whole dinghy and flush fresh water through the outboard's lower unit - salt in the shaft casing corrodes the motor hardware and seizes the tilt. No pressure washer (it drives water past the lip seals).")
O(211, n="Dinghy - Outboard Propeller Shaft Service", d="Check the outboard's underwater propeller shaft for tangled fishing line or seaweed wraps that can tear out the internal seals.", c="Carry propeller shear pins. Keep the pressure washer away from the outboard casing.")
O(371, d="If the dinghy outboard has not run in ~2 weeks, run it briefly (in a tank or off the transom at the dock) and cycle the tilt.", c="An outboard and its tilt mechanism seize from disuse and salt far faster than from running. A short run also keeps the prop-shaft seal wetted and the electrics from sitting damp.")
O(378, c="Dose INTO the tank while filling - the fill turbulence mixes it; adding it after leaves it stratified. Treat every load of dock fuel of unknown quality, no exceptions - the bug grows at the fuel/water interface. If a tank sat untreated or the fuel smells sour, shock-dose at the higher 'kill' rate, then polish. Keep the biocide stocked as a consumable with a real minimum quantity - running out in a remote anchorage is not a quick fix.")
O(256, c="Typical prefilters: 10\" spun-poly, 20 micron then 5 micron. Change monthly or when the boost-pump gauge shows restriction - the prefilters are sacrificial and cheap; a starved boost pump and a fouled membrane are not. Prime the new housings with product water, never raw seawater.")
O(175, c="Fiberglass tanks will not be eaten by the hydrogen sulfide from stagnant sewage, but it attacks the bronze fittings and any exposed metal over time, so don't let it sit. Inspect the sanitary hose, fittings and vent tubing for permeation/cracking on the same schedule as the pump hoses.")
O(781, n="Review/activate any annual safety-gear send-out", d="PFD beacon battery overhaul, liferaft recertification, scuba cylinder VIP/hydro and regulator/BCD service. The gear is accessible and the boat is out of commission anyway - a natural window to send it out.")
O(826, c="Do the washdown checks only after the raw-water inlets feeding those pumps are reopened - the pumps must not run dry. Know which switch panel each washdown pump is on.")
O(415, n="Drinking Water - Annual Jug Count, Condition & Stowage Security", d="Account for every drinking-water jug plus the bottled-water reserve, confirm each jug is serviceable (no persistent smell, taste or haze that won't clean, no crazing), and check the stowage: a full 5-gal jug is 35-42 lb and a set of them is well over 150 lb - chock and strap them so nothing breaks loose in a knockdown, and keep them out of direct sun.", c="Retire a jug on smell, taste or haze - they're cheap against a passage with bad water. A loose full 5-gal jug is a 40 lb projectile below decks; part-filling for handling also keeps the stow lighter. Budget a jug replacement every couple of years in the tropics; translucent jugs are the first to watch.")
O(412, d="Check each jug's screw-cap threads and the cap gasket/seal for deformation or perishing, the spigot/tap and any vent for cracks, drips and a clean seal, and the handle and body for stress cracks or hazing - translucent jugs especially, and any that have seen sun. Keep a spare spigot assembly with them and carry gasket stock.")
O(410, d="Keep the jugs in rotation off the watermaker: part-fill each to about 2 gal so it stays liftable, date it as you fill, use the oldest first, and don't let a filled jug sit more than about 2 weeks. When a jug comes empty, take the cap off, invert it to drain, and let it dry fully before the next fill.")
O(411, d="Staggered across the jugs: scrub the interior with a bottle brush, fill with a dilute unscented-bleach solution (about 1 tsp per gallon), cap and let stand ~15 min with a spell on its side to wet the cap and threads, dump, then rinse two or three times with watermaker water and air-dry cap-off. Do the spigot and vent cap too.", c="Biofilm builds on the walls and in the cap threads where the brush and the rinse don't reach - that is the source of a taste a plain refill won't fix. Don't use scented or splash-less bleach (additives you can't rinse out). If a jug still smells after sanitizing, retire it. A tank shock treatment is the equivalent job for the ship's tanks.")
O(413, c="The jugs are only as clean as the last thing that touched them. A shared deck-wash hose, a funnel that lived loose in a locker, or the product hose lying in the bilge undoes the sanitizing. The watermaker's own first draw after a flush carries preservative or stagnant permeate - run it off first. A jug pump's tube and neck seal are a contamination point too - rinse and dry it.")
O(219, n="Fishing Gear - Conventional Reel Internal Packing", d="Open the side plates of conventional (star-drag) reels and pack the gears with thick, salt-blocking reel grease.", c="Reel grease/oil and spare carbon drag washers on hand. Store with the drag backed off.")
O(220, n="Fishing Gear - Lever-Drag Reel Service", d="Strip down the side plates of lever-drag reels to clean the ball bearings and apply a light coat of anti-corrosive grease to the aluminium frames.", c="Reel grease/oil and spare carbon drag washers on hand. Store with the drag backed off.")
O(217, n="Fishing Gear - Rod Rack Audit", d="Check the mounting screws of the rod racks to ensure boat slamming hasn't loosened them.", c="Back the drag stars/levers to zero before racking rods - stored under tension, carbon drag washers flatten permanently and lose smooth payout.")
O(28, c="Replace with the filter maker's cartridge - prefer a chloramine-rated one, not just chlorine, which matters when topping up from municipal supplies. Shut the inlet, relieve pressure at the faucet, quarter-turn the old one out, date the housing.")
O(189, d="Lay the full chain (and any nylon rode) out on a dock. Swap it end-for-end so the heavily worn anchor-end section gets a rest in the deep locker.", c="Flake all the chain and nylon rode on the dock, inspect every link, swap end-for-end so the working end rests. Caliper a sample against new - retire the chain at ~10-12% diameter loss or first crack.")
O(301, c="Wipe the neoprene seals and treat with a rubber protectant (303, not silicone spray) - a hard or grit-imprinted gasket leaks under a boarding sea. Replace one that will not rebound; hatch gasket stock is a good spares item on an older boat.")
O(176, d="Clean off salt, dust and dirt.", c="Weekly fresh-water rinse - salt film alone costs several percent and etches the surface over time. Low pressure, soft cloth; flexible (CIGS) panels do not tolerate scrubbing.")
O(392, d="Charge camera, strobe and video-light batteries on the shelf, clean the housing bulkhead/hot-shoe and sync-cord contacts, and store the housing OPEN with the O-rings out.")
X(872, "Empty checklist in the source (no steps yet)")


# ---------------------------------------------------------------------------------------
# Systems tree. Devices (child rows) not listed keep their name. None = dropped (brand /
# model / owner-specific); their tasks are re-filed under the parent system.
# ---------------------------------------------------------------------------------------
_BRAND = "named for a specific make/model"
_LAYOUT = "owner-specific layout item"
DEVICE_MAP: dict[str, str | None] = {
    "DC-DC Converter - Berth A/C Fan Controller 24/24": None,
    "Sea Strainer  - Groco": None,
    "Sea Strainer - Seaflow": None,
    "Ventilation Fans (10)": "Ventilation Fans",
    "Bow & E/R Bilge Pumps (2)": "Bow & Engine Room Bilge Pumps",
    "Arch/ Hardtop": "Arch / Hardtop",
    "Companionway slider": "Companionway Slider",
    "24/12 Converter - 12V Fuse Circuit": None,
    "24/12 Converter - Always-On 12V Circuit": None,
    "24/12 Converter - Autopilot": None,
    "24/12 Converter - Garmin VHF": None,
    "24/12 Converter - ICOM VHF": None,
    "24/12 Converter - IT 12V Circuit": None,
    "Alternator Regulator - Wakespeed WS500 Pro": "Alternator Regulator",
    "Battery Monitor - House Smart Shunt": "Battery Monitor",
    "Battery Monitor - Starter Smart Shunt": None,
    "BatteryProtect - Victron": None,
    "High Output Alternator - Balmar": "High-Output Alternator",
    "Inverter-Charger - MultiPlus-II 24/5000": "Inverter-Charger",
    "Solar Controller - MPPT 150/45": "Solar Charge Controllers",
    "Solar Controller - MPPT 150/60": "Solar Charge Controllers",
    "Solar Controller - MPPT 150/85": "Solar Charge Controllers",
    "Starter Battery Charger - Orion DC-DC 24/12-30 (Yanmar starter)": None,
    "Starter Battery Charger - Orion DC-DC 24/12-30 (genset starter)": None,
    "Chart Plotter  - Nav Station": "Chart Plotters",
    "Chart Plotter - Helm (P)": "Chart Plotters",
    "Chart Plotter - Helm (SB)": "Chart Plotters",
    "NMEA 2000 Ethernet Gateway - Yacht Devices YDEN-02": None,
    "NMEA 2000 Gateway - Garmin GND 10": None,
    "RADAR": "Radar",
    "Run Time Indicator - Yacht Devices": None,
    "Satellite Communicator - Garmin Montana 750i (inReach)": "Satellite Communicator",
    "Ship PC": "Onboard Computer",
    "Starlink": None,
    "Stereo - Fusion MS-RA70": "Stereo",
    "YD Soft Switch Controller": None,
    "Fuel Filter Vacuum Sensor - Across Oceans Pulse": None,
    "Fuel/ Oil": "Fuel / Oil",
    "Genset Starter Battery": "Generator Starter Battery",
    "Spurs": "Line Cutter",
    "Raw Water Inlet - Aft #1": None,
    "Raw Water Inlet - Aft #2": None,
    "Raw Water Inlet - Forward": None,
    "Raw-Water Strainers (2)": "Raw-Water Strainers",
    "Keel-Cooled Refrigeration (3)": "Keel-Cooled Refrigeration",
    "Winches (2)": "Winches",
    "Black Water Pumps (2)": "Black Water Pumps",
    "Toilets (2)": "Toilets",
}
DEVICE_DROP_REASON: dict[str, str] = {
    "Starlink": "named for a specific service/product",
    "Raw Water Inlet - Aft #1": _LAYOUT, "Raw Water Inlet - Aft #2": _LAYOUT,
    "Raw Water Inlet - Forward": _LAYOUT,
    "24/12 Converter - 12V Fuse Circuit": _LAYOUT + " (one converter per circuit)",
    "24/12 Converter - Always-On 12V Circuit": _LAYOUT + " (one converter per circuit)",
    "24/12 Converter - Autopilot": _LAYOUT + " (one converter per circuit)",
    "24/12 Converter - Garmin VHF": _BRAND, "24/12 Converter - ICOM VHF": _BRAND,
    "24/12 Converter - IT 12V Circuit": _LAYOUT + " (one converter per circuit)",
}
TOP_RENAME = {"Tanks on General": "Tanks (General)"}

# Haul-out project: the owner wants anode replacement / prop lubrication in it. Setting
# project_id on a RECURRING library task would park it (a planned project's tasks drop off
# the rolling schedule), so instead the project gets one-off tasks copied from these lay-up
# checklist steps, each carrying task links to the recurring anode / prop tasks.
HAULOUT_FROM_STEPS = [775, 779]

# Regex clean-ups applied to every exported task text field (after overrides).
REGEX = [
    (re.compile(r"\s*\[(?:period-fix|element|equip|lee|gmail) \d{4}-\d{2}-\d{2}\].*$", re.S), ""),
    (re.compile(r"\s*Source: Captain's Locker evaluation.*?(?:Papers of Record|\d{4}-\d{2}-\d{2})\."), ""),
    (re.compile(r"\s*Added \d{4}-\d{2}-\d{2} from the owner's answers[^.]*\."), ""),
    (re.compile(r"\s*\(Written \d{4}-\d{2}-\d{2} from the owner's one-line description - review the wording\.\)"), ""),
    (re.compile(r"\s*\(Prompted by The Captain's Locker; the numbers are the manufacturers'\.\)"), ""),
    (re.compile(r"\bMarlon\b"), "Marelon"),
    (re.compile(r"\bTanks on General\b"), "Tanks (General)"),
]
# Device names safe to rename wherever they appear in text (distinctive strings only).
TEXT_RENAMES = sorted(
    ((old, new) for old, new in DEVICE_MAP.items() if new and ("(" in old or "/ " in old)),
    key=lambda p: -len(p[0]),
)

# Words that should not survive into a pack (residual check; reported, not fatal).
RESIDUAL = re.compile(
    r"\b(the owner|crew member|crew member|Owner|the automation developer|crew|the boat|Unladen|Swallow|Previous Name|Beneteau|"
    r"Beneateau|Seabrook|Grenada|Carriacou|Tyrell|Bequia|Yanmar|4JH\w*|Westerbeke|Max[- ]?Prop|PYI|"
    r"Victron|Garmin|SSM|Solid State|Frigoboat|Dometic|Seaflo\w*|SeaWater ?Pro|Gulper|Harken|"
    r"Selden|Quantum|Caribe|Revere|Rheem|Maxwell|Airmar|DST\d*|ICOM|Icom|em-trak|Hull Shield|Hella|"
    r"Engel|Wakespeed|Balmar|Marinco|Forespar|Groco|Spurs|KM4A2|Sta-?Lok|West End|Junius|Cerbo|"
    r"VRM|BougeRV|Ruuvi\w*|Reolink|Starlink|Fusion|Yacht Devices|YD\w*|Across Oceans|Water ?Drop|"
    r"Auertech|Vetus|SHURflo|Attwood|MultiPlus|Multiplus|Orion|SmartShunt|MPPT|Montana|inReach|"
    r"Captain'?s Locker|Sailing Services|Tampa|NOLA|Pensacola|your-pi-hostname|RPi|SignalK|Tailscale|"
    r"NAS|Syncthing|Synology|Raymarine|Mantus|Coltri|Edson|Moeller|Amazon|Maya|T-Mobile|Plex|"
    r"Jellyfin|Roku|Steel Breeze|Dwight|Kissimmee|HeartSine|Core Medical|Filmtec|Momentum|"
    r"GND ?10|GRF ?10|Reactor|Nexus|OGM|Weems|Marine Breeze|Turbo DX|Karcher|serial|invoice|"
    r"punch[- ]list|refit)\b|#\d+|\b20[12]\d\b|\$\d|[A-Z]:\\|\.pdf|\.docx?|\.xlsx",
)



def _about(what: str) -> dict:
    """The file-header convention, as data (JSON has no comments)."""
    return {
        "purpose": f"Optional starter pack for a new mx-inv install: {what}.",
        "version": "v1 (2026-09-24)",
        "scope": "STANDALONE UTILITY data - shipped in starter_packs/, never read by the app itself.",
        "architecture": "Generated by scripts/release/export_starter_packs.py; loaded on request by "
                        "load_starter_pack.py through data.py. Safe to load into a database that "
                        "already has your own boat - existing names are skipped.",
    }


def _ro_connect(path: str) -> sqlite3.Connection:
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    for rx, rep in REGEX:
        text = rx.sub(rep, text)
    for old, new in TEXT_RENAMES:
        text = text.replace(old, new)
    text = re.sub(r"[ \t]+\n", "\n", text).strip()
    return text or None


# =======================================================================================
# Recipes
# =======================================================================================
_ATTRIB_LINE = re.compile(r"^\s*(?:Owner|Crew|Owner & Crew)\s*$", re.M)
_RECIPE_SUBS = [
    (re.compile(r"Family recipe from Great Grandmother Lottie May Chase \(Stetson\)"), "Family recipe."),
    (re.compile(r"Great Grandmother Ella L Sprague.s \(Edson\) recipe"), "Family recipe."),
    (re.compile(r"suggestions by the owner & crew member Owner"), "suggestions"),
    (re.compile(r"\(the owner prefers the elbow"), "(one of us prefers the elbow"),
]
_RECIPE_SOURCE_RENAME = {"Owner-Wise Family Recipes": "Family Recipes"}
_RECIPE_TITLE_RENAME = {"the owner's Spaghetti Sauce": "Spaghetti Sauce (Family Recipe)"}


def export_recipes(conn: sqlite3.Connection) -> tuple[dict, dict]:
    tags: dict[int, dict[str, list[str]]] = defaultdict(lambda: {"ingredient": [], "method": [], "tag": []})
    for r in conn.execute("SELECT recipe_id, kind, tag FROM recipe_tags ORDER BY recipe_id, kind, tag"):
        tags[r["recipe_id"]][r["kind"]].append(r["tag"])
    rows = conn.execute("SELECT * FROM recipes ORDER BY recipe_id").fetchall()
    titles = Counter(r["title"] for r in rows)
    out, changes = [], []
    notes_dropped = notes_kept = 0
    for r in rows:
        title, source, body, notes = r["title"], r["source"], r["body"], r["notes"]
        what = []
        if title in _RECIPE_TITLE_RENAME:
            title = _RECIPE_TITLE_RENAME[title]
            what.append("title")
        if source in _RECIPE_SOURCE_RENAME:
            source = _RECIPE_SOURCE_RENAME[source]
            what.append("source")
            if titles[r["title"]] > 1:   # same title as another recipe: keep both loadable
                title = f"{title} (Family Recipe)"
                what.append("title")
        new_body = _ATTRIB_LINE.sub("", body)
        for rx, rep in _RECIPE_SUBS:
            new_body = rx.sub(rep, new_body)
        new_body = new_body.strip("\n")
        if new_body != body.strip("\n"):
            what.append("body (attribution / family names removed)")
        body = new_body
        if notes and notes.strip():
            # Every note in the live book is either a data-cleanup log line ("Split <date>
            # from recipe_id N") or personal; none is cooking content worth shipping.
            if re.match(r"^Split \d{4}-\d{2}-\d{2} ", notes) or RESIDUAL.search(notes):
                notes = None
                notes_dropped += 1
            else:
                notes_kept += 1
        else:
            notes = None
        if what:
            changes.append({"recipe_id": r["recipe_id"], "old_title": r["title"], "new_title": title,
                            "changed": sorted(set(what))})
        out.append({
            "title": title, "source": source, "servings": (r["servings"] or "").strip() or None,
            "body": body, "notes": notes,
            "tags": {k: v for k, v in tags[r["recipe_id"]].items() if v},
        })
    pack = {"_about": _about("the galley recipe book"), "format": PACK_FORMAT, "pack": "recipes", "pack_version": PACK_VERSION,
            "schema_version": SCHEMA_VERSION, "recipe_count": len(out), "recipes": out}
    stats = {"recipes": len(out), "notes_dropped": notes_dropped, "notes_kept": notes_kept,
             "changes": changes,
             "ingredient_lines_in_source": conn.execute("SELECT COUNT(*) FROM recipe_ingredients").fetchone()[0],
             "tag_counts": dict(Counter(k for d in tags.values() for k, v in d.items() for _ in v))}
    return pack, stats


# =======================================================================================
# Maintenance library
# =======================================================================================
def export_maintenance(conn: sqlite3.Connection) -> tuple[dict, dict]:
    systems = {r["name"]: dict(r) for r in conn.execute("SELECT * FROM systems")}
    tasks = {r["task_id"]: dict(r) for r in conn.execute("SELECT * FROM tasks WHERE retired_at IS NULL")}
    children: dict[int, list[int]] = defaultdict(list)
    for t in tasks.values():
        if t["parent_task_id"]:
            children[t["parent_task_id"]].append(t["task_id"])

    def sys_new(name: str) -> str:
        row = systems.get(name)
        if row is None or row["parent_name"] is None:
            return TOP_RENAME.get(name, name)
        new = DEVICE_MAP.get(name, name)
        return new if new else TOP_RENAME.get(row["parent_name"], row["parent_name"])

    # ---- systems ----
    sys_out, seen, dev_changes = [], set(), []
    tops = sorted((s for s in systems.values() if s["parent_name"] is None),
                  key=lambda s: (s["sort_order"] is None, s["sort_order"] or 0, s["name"]))
    for s in tops:
        n = TOP_RENAME.get(s["name"], s["name"])
        sys_out.append({"name": n, "parent": None, "sort_order": s["sort_order"]})
        seen.add(n)
        if n != s["name"]:
            dev_changes.append((s["name"], n, "renamed (top-level)"))
    devs = sorted((s for s in systems.values() if s["parent_name"] is not None),
                  key=lambda s: (s["parent_name"], s["sort_order"] is None, s["sort_order"] or 0, s["name"]))
    for s in devs:
        new = DEVICE_MAP.get(s["name"], s["name"])
        if new is None:
            dev_changes.append((s["name"], None, DEVICE_DROP_REASON.get(s["name"], _BRAND)))
            continue
        if new != s["name"]:
            dev_changes.append((s["name"], new, "renamed" if new not in seen else "merged into " + new))
        if new in seen:
            continue
        seen.add(new)
        sys_out.append({"name": new, "parent": TOP_RENAME.get(s["parent_name"], s["parent_name"]),
                        "sort_order": s["sort_order"]})

    # ---- which tasks go out ----
    dropped: dict[int, str] = {}

    def drop_subtree(tid: int, reason: str) -> None:
        dropped[tid] = reason
        for ch in children.get(tid, []):
            drop_subtree(ch, f"step of dropped checklist #{tid}")

    for tid, reason in DROPS.items():
        if tid in tasks:
            drop_subtree(tid, reason)

    def task_out(t: dict, key_prefix: str = "t") -> dict:
        ov = OVERRIDES.get(t["task_id"], {})
        name = ov.get("name", t["task_name"])
        desc = ov.get("description", t["task_description"])
        caut = ov.get("caution_notes", t["caution_notes"])
        for old, new in ov.get("sub", []):
            desc = desc.replace(old, new) if desc else desc
            caut = caut.replace(old, new) if caut else caut
        return {
            "key": f"{key_prefix}{t['task_id']}",
            "system": sys_new(t["system"]),
            "name": _clean(name),
            "description": _clean(desc) if desc else None,
            "caution_notes": _clean(caut) if caut else None,
            "task_kind": t["task_kind"],
            "interval_type": t["interval_type"],
            "period": t["period"],
            "hours_meter": t["hours_meter"],
            "is_critical": bool(t["is_critical"]),
        }

    exported: dict[int, dict] = {}   # task_id -> exported dict (for change review)

    recurring = [t for t in tasks.values() if t["task_kind"] == "recurring"
                 and t["parent_task_id"] is None and t["task_id"] not in dropped]
    recurring.sort(key=lambda t: (sys_new(t["system"]), t["task_name"]))
    rec_out = []
    for t in recurring:
        o = task_out(t)
        rec_out.append(o)
        exported[t["task_id"]] = o

    # ---- checklists (+ nested items, in their run order) ----
    refs = [dict(r) for r in conn.execute("SELECT * FROM task_references")]
    task_refs_by_src: dict[int, list[dict]] = defaultdict(list)
    for r in refs:
        if r["kind"] == "task":
            task_refs_by_src[r["task_id"]].append(r)

    top_checklists = [t for t in tasks.values() if t["task_kind"] == "checklist"
                      and t["parent_task_id"] is None and t["task_id"] not in dropped]
    top_checklists.sort(key=lambda t: t["task_name"])

    def checklist_items(cid: int) -> list[dict]:
        items = []
        for ch in children.get(cid, []):
            if ch in dropped:
                continue
            t = tasks[ch]
            o = task_out(t)
            o["type"] = "step"
            o["group"] = _clean(t["checklist_group"])
            exported[ch] = o
            if t["task_kind"] == "checklist":
                o["items"] = checklist_items(ch)
            items.append((t["sort_order"], t["task_name"], o))
        for r in task_refs_by_src.get(cid, []):
            tgt = tasks.get(r["ref_task_id"])
            if tgt is None:
                continue
            link = {"type": "link" if tgt["task_kind"] != "checklist" else "include",
                    "target": f"t{tgt['task_id']}", "group": _clean(r["checklist_group"]),
                    "_target_id": tgt["task_id"]}
            items.append((r["sort_order"], "~" + tgt["task_name"], link))
        items.sort(key=lambda x: (x[0] is None, x[0] or 0, x[1]))
        return [o for _, _, o in items]

    cl_out = []
    for t in top_checklists:
        o = task_out(t)
        o["items"] = checklist_items(t["task_id"])
        exported[t["task_id"]] = o
        cl_out.append(o)

    # ---- haul-out project ----
    proj = conn.execute("SELECT * FROM projects WHERE project_id = ?", (HAULOUT_PROJECT_ID,)).fetchone()
    ptasks = [t for t in tasks.values() if t["project_id"] == HAULOUT_PROJECT_ID]
    proj_one_off, proj_report, proj_step_links = [], [], []
    for t in sorted(ptasks, key=lambda t: t["task_id"]):
        if t["task_id"] in dropped:
            proj_report.append(("dropped", t, dropped[t["task_id"]]))
        elif t["task_kind"] == "recurring" and t["task_id"] in exported:
            proj_report.append(("NOT put on the project", t,
                                "stays a normal library task (on a planned project it would be parked off "
                                "the schedule); reached via the linked anode / prop one-off tasks"))
        elif t["task_kind"] == "one_off" and t["parent_task_id"] is None:
            o = task_out(t)
            exported[t["task_id"]] = o
            proj_one_off.append(o)
            proj_report.append(("kept", t, ""))
    for sid in HAULOUT_FROM_STEPS:
        if sid not in tasks or sid in dropped:
            continue
        o = task_out(tasks[sid], key_prefix="p")
        o.update(task_kind="one_off", interval_type="break_fix", period="once", hours_meter=None)
        proj_one_off.append(o)
        targets = [r["ref_task_id"] for r in task_refs_by_src.get(sid, []) if r["ref_task_id"] in exported]
        proj_step_links += [{"from": o["key"], "to": f"t{x}"} for x in targets]
        proj_report.append(("ADDED by exporter (copy of lay-up checklist step)", tasks[sid],
                            f"as: {o['name']}; links to library tasks {', '.join('#%d' % x for x in targets)}"))
    phases = [{"name": p["name"], "notes": p["notes"]} for p in conn.execute(
        "SELECT * FROM project_phases WHERE project_id = ? ORDER BY sort_order, phase_id",
        (HAULOUT_PROJECT_ID,))]
    projects_out = [{
        "name": "Next Haul-Out",
        "kind": proj["kind"] if proj else "haul_out",
        "description": "Jobs to do the next time the boat comes out of the water. The anode and "
                       "propeller jobs link to their recurring tasks in the maintenance library; "
                       "add your own yard items.",
        "phases": phases,
        "tasks": proj_one_off,
    }]

    # ---- references outside checklist ordering (task links + general standards) ----
    link_out, std_out = list(proj_step_links), []
    links_dropped = 0
    in_checklist_order = {(r["ref_id"]) for cid in (t["task_id"] for t in tasks.values()
                          if t["task_kind"] == "checklist") for r in task_refs_by_src.get(cid, [])}
    for r in refs:
        if r["task_id"] not in exported:
            continue
        if r["kind"] == "task":
            if r["ref_id"] in in_checklist_order:
                if r["ref_task_id"] not in exported:
                    links_dropped += 1
                continue
            if r["ref_task_id"] in exported:
                link_out.append({"from": f"t{r['task_id']}", "to": f"t{r['ref_task_id']}"})
            else:
                links_dropped += 1
        elif r["kind"] == "standard":
            label = re.sub(r"^.+ - manufacturer service guidance$", "Manufacturer service guidance", r["label"])
            std_out.append({"task": f"t{r['task_id']}", "label": label, "note": r["note"]})
    # checklist links whose target was not exported: strip them from the items
    def prune(items: list[dict]) -> list[dict]:
        keep = []
        for it in items:
            if it["type"] in ("link", "include"):
                if it.pop("_target_id") not in exported:
                    continue
            if "items" in it:
                it["items"] = prune(it["items"])
            keep.append(it)
        return keep
    for c in cl_out:
        c["items"] = prune(c["items"])

    pack = {
        "_about": _about("generic maintenance library - systems, recurring tasks, checklists "
                         "and a haul-out project"),
        "format": PACK_FORMAT, "pack": "maintenance", "pack_version": PACK_VERSION,
        "schema_version": SCHEMA_VERSION,
        "notes": "All tasks load as never done. hours_meter: 'engine' = main engine hours, "
                 "'genset' = generator hours.",
        "systems": sys_out, "tasks": rec_out, "checklists": cl_out,
        "projects": projects_out, "task_links": link_out, "standard_references": std_out,
    }
    stats = {
        "tasks": tasks, "exported": exported, "dropped": dropped, "dev_changes": dev_changes,
        "systems": sys_out, "rec_out": rec_out, "cl_out": cl_out, "proj_report": proj_report,
        "links": len(link_out), "links_dropped": links_dropped, "std": len(std_out),
        "source_recurring": sum(1 for t in tasks.values() if t["task_kind"] == "recurring"),
        "source_checklists": sum(1 for t in tasks.values() if t["task_kind"] == "checklist"
                                 and t["parent_task_id"] is None),
    }
    return pack, stats


# =======================================================================================
# REVIEW.md
# =======================================================================================
def _md(s: str | None) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def write_review(path: Path, rstats: dict, mstats: dict) -> None:
    tasks, exported, dropped = mstats["tasks"], mstats["exported"], mstats["dropped"]
    changed = []
    for tid, o in sorted(exported.items()):
        t = tasks[tid]
        fields = []
        if o["name"] != t["task_name"]:
            fields.append("name")
        if (o["description"] or None) != (t["task_description"] or None):
            fields.append("description")
        if (o["caution_notes"] or None) != (t["caution_notes"] or None):
            fields.append("caution")
        if o["system"] != t["system"]:
            fields.append("system")
        if fields:
            changed.append((tid, t, o, fields))
    by_kind = Counter()
    for tid in exported:
        t = tasks[tid]
        by_kind["checklist" if t["task_kind"] == "checklist" and t["parent_task_id"] is None
                else "step" if t["parent_task_id"] else t["task_kind"]] += 1
    drop_kind = Counter("checklist" if tasks[t]["task_kind"] == "checklist" and tasks[t]["parent_task_id"] is None
                        else "step" if tasks[t]["parent_task_id"] else tasks[t]["task_kind"] for t in dropped)
    text_changed = [c for c in changed if set(c[3]) - {"system"}]
    L = [
        "<!--",
        "Purpose: Owner review sheet for the release starter packs - every generalised or dropped",
        "  item, so the owner can skim and veto before release.",
        "Version: v1 (2026-09-24)",
        "Scope: STANDALONE UTILITY output - NOT SHIPPED. build_release must leave this file out; it",
        "  quotes the original (private) text on purpose.",
        "Architecture: Generated by scripts/release/export_starter_packs.py from the live database",
        "  (read-only). Re-run the exporter after changing its override map; do not hand-edit.",
        "-->",
        "# Starter packs - owner review (NOT SHIPPED)",
        "",
        "Generated by `scripts/release/export_starter_packs.py`. To veto or reword anything, edit the",
        "`OVERRIDES` / `X(...)` entries (keyed by the live task id shown here) or `DEVICE_MAP` in the",
        "exporter and re-run it. This file is not part of the release.",
        "",
        "## Counts",
        "",
        "| Pack | Item | Exported | Text generalised | Dropped |",
        "|---|---|---|---|---|",
        f"| recipes | recipes | {rstats['recipes']} | {len(rstats['changes'])} | 0 |",
        f"| recipes | recipe notes | {rstats['notes_kept']} | - | {rstats['notes_dropped']} |",
    ]
    for kind in ("recurring", "checklist", "step", "one_off"):
        n_ch = sum(1 for c in text_changed if (
            "checklist" if c[1]["task_kind"] == "checklist" and c[1]["parent_task_id"] is None
            else "step" if c[1]["parent_task_id"] else c[1]["task_kind"]) == kind)
        label = {"recurring": "recurring tasks", "checklist": "checklists",
                 "step": "checklist steps", "one_off": "haul-out project one-off tasks kept from source (+2 added, see below)"}[kind]
        L.append(f"| maintenance | {label} | {by_kind[kind]} | {n_ch} | {drop_kind[kind]} |")
    n_dev_drop = sum(1 for d in mstats["dev_changes"] if d[1] is None)
    n_dev_ren = sum(1 for d in mstats["dev_changes"] if d[1] is not None)
    L += [
        f"| maintenance | systems + devices | {len(mstats['systems'])} | {n_dev_ren} renamed/merged | {n_dev_drop} |",
        f"| maintenance | task-to-task links (outside checklists) | {mstats['links']} | - | {mstats['links_dropped']} (target not exported) |",
        f"| maintenance | general references (ABYC, Calder, ...) | {mstats['std']} | - | manuals / invoices / notes not exported |",
        "",
        "Not exported at all: stock, items / catalog, parts linked to tasks, completion history,",
        "documents, crew, storage, meter readings, deferrals, last-completed dates (every task loads",
        "as never done), manual file references, and every other project.",
        "",
        "Run-hours note: the app gives every `hrs` task an hour meter (default: main engine). Source",
        "tasks with `hrs` and no meter (watermaker HP pump, dive compressor, Watch Handover checklist)",
        "will therefore count main-engine hours after loading - change them in the app if needed.",
        "",
        "## Recipes",
        "",
        f"All {rstats['recipes']} recipes are exported with title, source, servings, body and their",
        f"tags ({', '.join(f'{k}: {v}' for k, v in sorted(rstats['tag_counts'].items()))}).",
        f"{rstats['notes_dropped']} notes dropped - every one was a data-cleanup log line",
        "(\"Split <date> from ... recipe_id N\"), none was cooking content.",
        f"Ingredient lines: NOT exported ({rstats['ingredient_lines_in_source']} rows in 6 recipes, all tied to",
        "the owner's food catalog). The loader does not parse them either - see the loader note below.",
        "",
        "Remaining privacy-scan hits in recipes.json are the food word \"brownie\" (singular),",
        "which the scanner cannot tell from the person's name - check the scan output.",
        "",
        "| Recipe id | Old title | New title | What changed |",
        "|---|---|---|---|",
    ]
    for c in rstats["changes"]:
        L.append(f"| {c['recipe_id']} | {_md(c['old_title'])} | {_md(c['new_title'])} | {', '.join(c['changed'])} |")
    L += [
        "",
        "Loader and ingredient parsing: `data.parse_recipe_ingredients()` is an on-demand, ephemeral",
        "parse that fuzzy-matches lines against the user's own food catalog and saves nothing; the",
        "user reviews it and the app saves it when a recipe is first cooked or planned. The loader",
        "therefore does NOT call it (on a fresh install there is no catalog to match against).",
        "",
        "## Systems / devices",
        "",
        "| Old | New | Why |",
        "|---|---|---|",
    ]
    for old, new, why in mstats["dev_changes"]:
        L.append(f"| {_md(old)} | {_md(new) if new else '**DROPPED** (tasks re-filed under its parent)'} | {why} |")
    L += ["", "## Next Haul-Out project", "",
          "| Task id | Source name | Result | Note |", "|---|---|---|---|"]
    for res, t, note in mstats["proj_report"]:
        new = exported.get(t["task_id"], {}).get("name")
        L.append(f"| {t['task_id']} | {_md(t['task_name'])} | {res}{' as: ' + _md(new) if new and new != t['task_name'] else ''} | {_md(note)} |")
    L += ["", "## Dropped tasks", "", "| Task id | Kind | Name | Reason |", "|---|---|---|---|"]
    for tid in sorted(dropped):
        t = tasks[tid]
        L.append(f"| {tid} | {t['task_kind']} | {_md(t['task_name'])} | {_md(dropped[tid])} |")
    L += ["", "## Changed tasks", "",
          "Old -> new name and which fields changed. Full old/new text for each is in the next section.",
          "", "| Task id | Old name | New name | Changed |", "|---|---|---|---|"]
    for tid, t, o, fields in changed:
        L.append(f"| {tid} | {_md(t['task_name'])} | {_md(o['name']) if o['name'] != t['task_name'] else '(same)'} | {', '.join(fields)} |")
    L += ["", "## Changed text in full", ""]
    for tid, t, o, fields in text_changed:
        L.append(f"<details><summary>#{tid} {_md(o['name'])}</summary>\n")
        for f, src, key in (("description", "task_description", "description"),
                            ("caution", "caution_notes", "caution_notes")):
            if f in fields:
                L.append(f"- **{f} - old:** {_md(t[src]) or '(empty)'}")
                L.append(f"- **{f} - new:** {_md(o[key]) or '(empty)'}")
        L.append("\n</details>\n")
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def _residual_report(pack: dict, label: str) -> int:
    hits = 0

    def walk(x, where):
        nonlocal hits
        if isinstance(x, dict):
            for k, v in x.items():
                walk(v, f"{where}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                walk(v, f"{where}[{i}]")
        elif isinstance(x, str) and label != "recipes":
            for m in RESIDUAL.finditer(x):
                hits += 1
                print(f"  residual {label}{where}: {m.group(0)!r} in ...{x[max(0, m.start()-50):m.end()+40]!r}",
                      file=sys.stderr)
    walk(pack, "")
    return hits


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default=LIVE_DB, help="source database (opened read-only)")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "release_files" / "starter_packs"))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    conn = _ro_connect(args.db)
    try:
        ver = conn.execute("SELECT value FROM system_config WHERE key = 'schema_version'").fetchone()[0]
        if int(ver) != SCHEMA_VERSION:
            print(f"warning: source schema v{ver}, exporter written for v{SCHEMA_VERSION}", file=sys.stderr)
        rpack, rstats = export_recipes(conn)
        mpack, mstats = export_maintenance(conn)
    finally:
        conn.close()
    for name, pack in (("recipes.json", rpack), ("maintenance_library.json", mpack)):
        (out / name).write_text(json.dumps(pack, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    write_review(out / "REVIEW.md", rstats, mstats)
    res = _residual_report(mpack, "maintenance")
    print(f"recipes: {rstats['recipes']} (notes dropped {rstats['notes_dropped']})")
    print(f"maintenance: {len(mpack['systems'])} systems, {len(mpack['tasks'])} recurring tasks, "
          f"{len(mpack['checklists'])} checklists, {len(mstats['dropped'])} tasks dropped, "
          f"{mstats['links']} links, {mstats['std']} references; residual-word hits: {res}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
