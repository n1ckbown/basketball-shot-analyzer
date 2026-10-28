import numpy as np

from app.form import Pose, angle, find_releases, measure

FPS = 30
RELEASE = 10


def figure(lift=0.0, arm_up=True, knee_out=0.0):
    """A shooter facing right, torso 50 px long; `lift` raises the whole body (a jump), image y points down."""
    kp = np.zeros((17, 2))
    kp[0] = (100, 0)  # nose
    kp[5], kp[6] = (95, 20), (105, 20)  # shoulders
    if arm_up:  # straight arm up from the right shoulder
        kp[7], kp[8], kp[9], kp[10] = (90, 40), (105, -5), (90, 60), (105, -30)
    else:
        kp[7], kp[8], kp[9], kp[10] = (90, 40), (110, 40), (90, 60), (110, 60)
    kp[11], kp[12] = (95, 70), (105, 70)  # hips
    kp[13], kp[14] = (95 + knee_out, 100), (105 + knee_out, 100)  # knees
    kp[15], kp[16] = (95, 130), (105, 130)  # ankles
    kp[:, 1] -= lift
    return kp


def shot(follow_through_frames=15, jump_peak=RELEASE):
    """Dip, then jump and release at frame 10: the ball leaves the raised right hand going up."""
    poses = {}
    for i in range(40):
        lift = max(0.0, 10 - abs(i - jump_peak)) if i > 2 else 0.0  # feet up to 10 px (0.2 torso) at the peak
        kp = figure(lift, arm_up=i <= RELEASE + follow_through_frames, knee_out=20 if i == 3 else 0)
        wrist = kp[10]
        ball = (wrist[0], wrist[1]) if i <= RELEASE else (wrist[0] + 20 * (i - RELEASE), wrist[1] - 35 * (i - RELEASE))
        poses[i] = Pose(kp, ball)
    return poses


def test_release_is_the_last_frame_the_ball_is_in_the_raised_hand():
    assert find_releases(shot(), FPS) == [RELEASE]


def test_a_raised_hand_without_the_ball_leaving_it_is_not_a_shot():
    poses = {i: Pose(figure(), ball=tuple(figure()[10])) for i in range(40)}  # holding the ball overhead

    assert find_releases(poses, FPS) == []


def test_form_measurements():
    form = measure(RELEASE, shot(), FPS)

    assert form.elbow_at_release == 180
    assert form.knee_bend == round(angle((95, 70), (115, 100), (95, 130)))  # the dip at frame 3
    assert form.release_timing == "at the top"
    assert form.follow_through == 0.5  # 15 frames


def test_release_timing_relative_to_the_jump():
    assert measure(RELEASE, shot(jump_peak=RELEASE + 5), FPS).release_timing == "rising"
    assert measure(RELEASE, shot(jump_peak=RELEASE - 5), FPS).release_timing == "falling"
