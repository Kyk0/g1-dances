# Notices

- Motions: G1 Dances (https://huggingface.co/datasets/Kyry10/g1-dances), derived from the AIST Dance Video Database / AIST++.
  Required citation: Tsuchida et al., AIST Dance Video Database, ISMIR 2019. Commercial use: AIST Dance DB Terms of Use.
  `motions/*.bin` are the same trajectories resampled to 30 fps (float32, T x 36 qpos) for the browser.
- Robot model: Unitree G1 29-DoF kinematics and meshes, Copyright (c) Unitree Robotics, BSD 3-Clause License,
  as distributed in NVIDIA GR00T-WholeBodyControl. Meshes are decimated for the web (`robot.bin`).
- three.js (MIT), loaded from the jsDelivr CDN.
