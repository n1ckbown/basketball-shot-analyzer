from app.detection import Detection
from app.shots import arc_height, check_setup, find_shots, locate_rim

# Rim at x 100-200, y 100-150; the backboard behind it scores higher, as in real footage.
BACKBOARD = Detection("hoop", 0.9, (120, 20, 220, 140))
RIM = Detection("hoop", 0.5, (100, 100, 200, 150))
FLOODLIGHT = Detection("hoop", 0.95, (500, 100, 600, 150))
APPROACH = [(20, 40), (60, 50), (100, 60), (140, 80)]


def frames_for(path, hoops=(BACKBOARD, RIM)):
    def ball(x, y):
        return Detection("ball", 0.8, (x - 10, y - 10, x + 10, y + 10))

    # None in the path is a frame where the ball isn't seen.
    return [(i, [*hoops, ball(*p)]) for i, p in enumerate(path) if p]


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


def test_rim_bounce_out_of_the_picture_is_one_shot():
    # With the rim near the top of the frame, a high bounce leaves the picture for over a second.
    up_and_away = [(200, 60), (220, 20)] + [None] * 40 + [(240, 30), (250, 90), (260, 300)]
    shots = find_shots(frames_for(APPROACH + up_and_away), fps=30)
    assert [s.made for s in shots] == [False]


def test_setup_check_wants_the_hoop_in_view_with_room_above_and_big_enough():
    def rim_at(top, width=100):
        return [BACKBOARD, Detection("hoop", 0.5, (100, top, 100 + width, top + width // 2))]

    assert check_setup([], 1000) == {"hoop": False, "room_above": False, "close_enough": False}
    assert check_setup(rim_at(200), 1000) == {"hoop": True, "room_above": True, "close_enough": True}
    assert check_setup(rim_at(50), 1000)["room_above"] is False  # one rim height from the top
    assert check_setup(rim_at(200, width=30), 1000)["close_enough"] is False  # 3% of the picture width


def test_setup_check_is_unsure_without_a_rim_shaped_box():
    rim_and_backboard = Detection("hoop", 0.4, (100, 20, 220, 140))  # square: not clearly a rim

    assert check_setup([BACKBOARD, rim_and_backboard], 1000) == {"hoop": True, "room_above": None, "close_enough": None}
    rim = Detection("hoop", 0.4, (100, 200, 200, 250))
    lookalike_near_the_top = Detection("hoop", 0.5, (600, 20, 700, 40))  # more confident, but far from the hoop
    assert check_setup([BACKBOARD, rim, lookalike_near_the_top], 1000)["room_above"] is True


def flight(ball_width, times):
    """A ball 1 m above the rim top at t=0.5 s, filmed at 1 cm per pixel, at 30 fps."""
    pixels_per_second_squared = 9.81 / 2 / 0.01
    return {round(t * 30): (150, 0 + pixels_per_second_squared * (t - 0.5) ** 2, ball_width) for t in times}


def test_arc_is_measured_with_gravity_as_the_ruler():
    whole_flight = [i / 30 for i in range(31)]
    rim = (100, 100, 200, 150)

    assert arc_height(30, flight(26, whole_flight), rim, fps=30) == 3.3  # 1 m in feet
    # The ball's size says 2.5 times closer than gravity does: not a free flight, so no arc.
    assert arc_height(30, flight(60, whole_flight), rim, fps=30) is None
    # Only the way down was seen: the top can't be trusted.
    assert arc_height(30, flight(26, [i / 30 for i in range(15, 31)]), rim, fps=30) is None
