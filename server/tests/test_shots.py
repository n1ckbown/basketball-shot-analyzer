from app.detection import Detection
from app.shots import find_shots, locate_rim

# Rim at x 100-200, y 100-150; the backboard behind it scores higher, as in real footage.
BACKBOARD = Detection("hoop", 0.9, (120, 20, 220, 140))
RIM = Detection("hoop", 0.5, (100, 100, 200, 150))
FLOODLIGHT = Detection("hoop", 0.95, (500, 100, 600, 150))
APPROACH = [(20, 40), (60, 50), (100, 60), (140, 80)]


def frames_for(path, hoops=(BACKBOARD, RIM)):
    def ball(x, y):
        return Detection("ball", 0.8, (x - 10, y - 10, x + 10, y + 10))

    return [(i, [*hoops, ball(x, y)]) for i, (x, y) in enumerate(path)]


def test_locate_rim_picks_the_wide_box_at_the_usual_hoop_spot():
    frames = frames_for(APPROACH) + [(10, [BACKBOARD, RIM, FLOODLIGHT])]
    assert locate_rim(frames) == RIM.box
    assert locate_rim([(0, [])]) is None


def test_ball_dropping_through_the_middle_is_a_make():
    shots = find_shots(frames_for(APPROACH + [(150, 130), (150, 170), (150, 200), (150, 240), (150, 320)]), fps=30)
    assert [s.made for s in shots] == [True]


def test_ball_bouncing_away_is_a_miss():
    shots = find_shots(frames_for(APPROACH + [(200, 60), (250, 40), (300, 30), (350, 80), (380, 300)]), fps=30)
    assert [s.made for s in shots] == [False]


def test_ground_bounce_under_the_rim_is_not_a_make():
    off_front = [(90, 130), (80, 200), (70, 320)]
    bounce_back_up = [(150, 300), (150, 220), (150, 200), (150, 230)]
    shots = find_shots(frames_for(APPROACH + off_front + bounce_back_up), fps=30)
    assert [s.made for s in shots] == [False]


def test_put_back_after_a_miss_is_a_make():
    off_front = [(90, 130), (80, 200), (70, 320)]
    back_up_and_in = [(150, 200), (150, 140), (150, 90), (150, 170), (150, 200), (150, 240)]
    shots = find_shots(frames_for(APPROACH + off_front + back_up_and_in), fps=30)
    assert [s.made for s in shots] == [True]


def test_ball_dropping_past_the_rim_from_outside_is_a_miss():
    outside = [(20, 90), (40, 120), (90, 170), (110, 200), (120, 300)]
    shots = find_shots(frames_for([(0, 40), (10, 60)] + outside), fps=30)
    assert [s.made for s in shots] == [False]
